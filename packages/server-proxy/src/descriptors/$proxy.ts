import { type Async, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";

/**
 * Creates a proxy descriptor to forward requests to another server.
 *
 * @example
 * ```ts
 * import { $proxy } from "@alepha/server-proxy";
 *
 * class App {
 *   api = $proxy({ path: "/api", target: "https://api.example.com" });
 * }
 * ```
 */
export const $proxy = (options: ProxyDescriptorOptions): ProxyDescriptor => {
	return createDescriptor(ProxyDescriptor, options);
};

export type ProxyDescriptorOptions = {
	/**
	 * Path to match for proxying. This can be a static string or a function that returns a string.
	 * The path can include wildcards (e.g., `/api/*`) to match multiple routes.
	 */
	path: string;

	/**
	 * Target URL or function that returns the target URL to which requests should be proxied.
	 * This can be a static string or a function that returns a string, allowing for dynamic target resolution.
	 */
	target: string | (() => string);

	/**
	 * If true, the proxy is disabled and will not forward any requests.
	 * Default is false.
	 */
	disabled?: boolean;

	beforeRequest?: (
		request: ServerRequest,
		proxyRequest: RequestInit,
	) => Async<void>;

	afterResponse?: (
		request: ServerRequest,
		proxyResponse: Response,
	) => Async<void>;

	rewrite?: (url: URL) => void;

	// TODO:

	// retry: RetryOptions;
};

export class ProxyDescriptor extends Descriptor<ProxyDescriptorOptions> {}

$proxy[KIND] = ProxyDescriptor;
