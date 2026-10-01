import { type Async, createPrimitive, KIND, Primitive } from "alepha";
import type { ServerRequest } from "alepha/server";

/**
 * Creates a proxy primitive to forward requests to another server.
 *
 * This primitive enables you to create reverse proxy functionality, allowing your Alepha server
 * to forward requests to other services while maintaining a unified API surface. It's particularly
 * useful for microservice architectures, API gateways, or when you need to aggregate multiple
 * services behind a single endpoint.
 *
 * **Key Features**
 *
 * - **Path-based routing**: Match specific paths or patterns to proxy
 * - **Dynamic targets**: Support both static and dynamic target resolution
 * - **Request/Response hooks**: Modify requests before forwarding and responses after receiving
 * - **URL rewriting**: Transform URLs before forwarding to the target
 * - **Conditional proxying**: Enable/disable proxies based on environment or conditions
 *
 * @example
 * **Basic proxy setup:**
 * ```ts
 * import { $proxy } from "alepha/server/proxy";
 *
 * class ApiGateway {
 *   // Forward all /api/* requests to external service
 *   api = $proxy({
 *     path: "/api/*",
 *     target: "https://api.example.com"
 *   });
 * }
 * ```
 *
 * @example
 * **Dynamic target with environment-based routing:**
 * ```ts
 * class ApiGateway {
 *   // Route to different environments based on configuration
 *   api = $proxy({
 *     path: "/api/*",
 *     target: () => process.env.NODE_ENV === "production"
 *       ? "https://api.prod.example.com"
 *       : "https://api.dev.example.com"
 *   });
 * }
 * ```
 *
 * @example
 * **Advanced proxy with request/response modification:**
 * ```ts
 * class SecureProxy {
 *   secure = $proxy({
 *     path: "/secure/*",
 *     target: "https://secure-api.example.com",
 *     beforeRequest: async (request, proxyRequest) => {
 *       // Add authentication headers
 *       proxyRequest.headers = {
 *         ...proxyRequest.headers,
 *         'Authorization': `Bearer ${await getServiceToken()}`,
 *         'X-Forwarded-For': request.headers['x-forwarded-for'] || request.ip
 *       };
 *     },
 *     afterResponse: async (request, proxyResponse) => {
 *       // Log response for monitoring
 *       console.log(`Proxied ${request.url} -> ${proxyResponse.status}`);
 *     },
 *     rewrite: (url) => {
 *       // Remove /secure prefix when forwarding
 *       url.pathname = url.pathname.replace('/secure', '');
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Conditional proxy based on feature flags:**
 * ```ts
 * class FeatureProxy {
 *   newApi = $proxy({
 *     path: "/v2/*",
 *     target: "https://new-api.example.com",
 *     disabled: !process.env.ENABLE_V2_API // Disable if feature flag is off
 *   });
 * }
 * ```
 */
export const $proxy = (options: ProxyPrimitiveOptions): ProxyPrimitive => {
  return createPrimitive(ProxyPrimitive, options);
};

export type ProxyPrimitiveOptions = {
  /**
   * Path pattern to match for proxying requests.
   *
   * Must end with `/*` — the wildcard captures the rest of the path to
   * forward upstream:
   * - `/api/*` - Matches all paths starting with `/api/`
   * - `/api/v1/*` - Matches all paths starting with `/api/v1/`
   *
   * @example "/api/*"
   * @example "/secure/admin/*"
   */
  path: string;

  /**
   * Target URL to which matching requests should be forwarded.
   *
   * Can be either:
   * - **Infer string**: A fixed URL like `"https://api.example.com"`
   * - **Dynamic function**: A function that returns the URL, enabling runtime target resolution
   *
   * The target URL will be combined with the remaining path from the original request.
   *
   * @example "https://api.example.com"
   * @example () => process.env.API_URL || "http://localhost:3001"
   */
  target: string | (() => string);

  /**
   * Whether this proxy is disabled.
   *
   * When `true`, requests matching the path will not be proxied and will be handled
   * by other routes or return 404. Useful for feature toggles or conditional proxying.
   *
   * @default false
   * @example !process.env.ENABLE_PROXY
   */
  disabled?: boolean;

  /**
   * Hook called before forwarding the request to the target server.
   *
   * Use this to:
   * - Add authentication headers
   * - Modify request headers or body
   * - Add request tracking/logging
   * - Transform the request before forwarding
   *
   * @param request - The original incoming server request
   * @param proxyRequest - The request that will be sent to the target (modifiable)
   *
   * @example
   * ```ts
   * beforeRequest: async (request, proxyRequest) => {
   *   proxyRequest.headers = {
   *     ...proxyRequest.headers,
   *     'Authorization': `Bearer ${await getToken()}`,
   *     'X-Request-ID': generateRequestId()
   *   };
   * }
   * ```
   */
  beforeRequest?: (
    request: ServerRequest,
    proxyRequest: RequestInit,
  ) => Async<void>;

  /**
   * Hook called after receiving the response from the target server.
   *
   * Use this to:
   * - Log response details for monitoring
   * - Add custom headers to the response
   * - Transform response data
   * - Handle error responses
   *
   * @param request - The original incoming server request
   * @param proxyResponse - The response received from the target server
   *
   * @example
   * ```ts
   * afterResponse: async (request, proxyResponse) => {
   *   console.log(`Proxy ${request.method} ${request.url} -> ${proxyResponse.status}`);
   *
   *   if (!proxyResponse.ok) {
   *     await logError(`Proxy error: ${proxyResponse.status}`, { request, response: proxyResponse });
   *   }
   * }
   * ```
   */
  afterResponse?: (
    request: ServerRequest,
    proxyResponse: Response,
  ) => Async<void>;

  /**
   * Function to rewrite the URL before sending to the target server.
   *
   * Use this to:
   * - Remove or add path prefixes
   * - Transform path parameters
   * - Modify query parameters
   * - Change the URL structure entirely
   *
   * The function receives a mutable URL object and should modify it in-place.
   *
   * @param url - The URL object to modify (mutable)
   *
   * @example
   * ```ts
   * // Remove /api prefix when forwarding
   * rewrite: (url) => {
   *   url.pathname = url.pathname.replace('/api', '');
   * }
   * ```
   *
   * @example
   * ```ts
   * // Add version prefix
   * rewrite: (url) => {
   *   url.pathname = `/v2${url.pathname}`;
   * }
   * ```
   */
  rewrite?: (url: URL) => void;

  // TODO: Add retry functionality
  // retry?: RetryOptions;
};

export class ProxyPrimitive extends Primitive<ProxyPrimitiveOptions> {}

$proxy[KIND] = ProxyPrimitive;
