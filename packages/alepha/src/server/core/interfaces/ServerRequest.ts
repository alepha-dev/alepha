import type {
  IncomingMessage,
  ServerResponse as NodeServerResponse,
} from "node:http";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import type {
  Async,
  FileSchema,
  PipelineHandler,
  SchemaOutput,
  StreamLike,
  StreamSchema,
  ZObject,
  ZodArray,
  ZodRecord,
  ZodString,
  ZodVoid,
} from "alepha";
import type { Route } from "alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type { ServerReply } from "../helpers/ServerReply.ts";
import type { UserAgentInfo } from "../services/UserAgentParser.ts";

/**
 * What may appear in `schema.body` / `schema.response`.
 *
 * Both unions read as a whitelist but do not behave as one: `StreamSchema` and
 * `FileSchema` are aliases of `ZType`, the supertype of every member, so each
 * union collapses to "any schema". Listing the members is still worth it — it
 * documents what is actually *handled* downstream, and a reader reaching for
 * something exotic is warned — but do not rely on the compiler to reject a
 * shape the serializer cannot produce.
 *
 * Narrowing them for real is a breaking change (schemas that compile today
 * would stop), so it is a deliberate decision, not a cleanup.
 */
export type TRequestBody =
  | ZObject
  | ZodString
  | ZodArray
  | ZodRecord
  | StreamSchema;
export type TResponseBody =
  | ZObject
  | ZodString
  | ZodRecord
  | FileSchema
  | ZodArray
  | StreamSchema
  | ZodVoid;

export interface RequestConfigSchema {
  body?: TRequestBody;
  params?: ZObject;
  query?: ZObject;
  headers?: ZObject;
  response?: TResponseBody;
}

export interface ServerRequestConfig<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
  body: SchemaOutput<TConfig["body"], any>;

  headers: SchemaOutput<TConfig["headers"], Record<string, string>>;

  params: SchemaOutput<TConfig["params"], Record<string, string>>;

  query: SchemaOutput<TConfig["query"], Record<string, any>>;
}

export type ServerRequestConfigEntry<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> = Partial<ServerRequestConfig<TConfig>>;

// ---------------------------------------------------------------------------------------------------------------------

export interface ServerRequest<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRequestConfig<TConfig> {
  /**
   * HTTP method used for this request.
   */
  method: RouteMethod;

  /**
   * Full request URL.
   */
  url: URL;

  /**
   * Unique request ID assigned to this request.
   */
  requestId: string;

  /**
   * Client IP address.
   * Uses `X-Forwarded-For` header when `TRUST_PROXY=true`.
   */
  ip?: string;

  /**
   * Value of the `Host` header sent by the client.
   */
  host?: string;

  /**
   * Browser user agent information.
   * Information are not guaranteed to be accurate. Use with caution.
   *
   * @see {@link UserAgentParser}
   */
  userAgent: UserAgentInfo;

  /**
   * Geolocation information derived from proxy headers.
   * Available when behind Cloudflare, Vercel, or similar CDNs.
   */
  geo: RequestGeo;

  /**
   * Whether the request appears to be from a bot/crawler.
   * Based on user-agent analysis.
   */
  isBot: boolean;

  /**
   * Whether the request is from a mobile device.
   * Based on user-agent analysis.
   */
  isMobile: boolean;

  /**
   * Request protocol (http or https).
   * Uses `X-Forwarded-Proto` header when behind a proxy.
   */
  protocol: "http" | "https";

  /**
   * Preferred language from `Accept-Language` header.
   * Returns the first/most preferred language code (e.g., "en", "fr", "en-US").
   */
  language?: string;

  /**
   * Parsed referer information.
   * Undefined if no Referer header or invalid URL.
   */
  referer?: RequestReferer;

  /**
   * Arbitrary metadata attached to the request. Can be used by middlewares to store information.
   */
  metadata: Record<string, any>;

  /**
   * Reply object to be used to send response.
   */
  reply: ServerReply;

  /**
   * The raw underlying request object (Web Request).
   */
  raw: ServerRawRequest;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ServerRoute<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends Route {
  /**
   * Handler function for this route.
   */
  handler: PipelineHandler;

  /**
   * HTTP method for this route.
   */
  method?: RouteMethod;

  /**
   * Request/response schema for this route.
   *
   * Request schema contains:
   * - body, for POST/PUT/PATCH requests
   * - params, for URL parameters (e.g. /user/:id)
   * - query, for URL query parameters (e.g. /user?id=123)
   * - headers, for HTTP headers
   *
   * Response schema contains:
   * - response
   *
   * Response schema is used to validate and serialize the response sent by the handler.
   */
  schema?: TConfig;

  /**
   * @see ServerLoggerProvider
   */
  silent?: boolean;

  /**
   * Mark this `GET` route as prerenderable. When `true`, the build invokes the
   * handler in-process and writes its body verbatim to `dist/public/{path}`,
   * so the route is served as a static file (e.g. `sitemap.xml`, `robots.txt`).
   * The route still serves live at request time for runtimes that have a server.
   */
  static?: boolean;
}

/**
 * Input type for `createRoute()`. Accepts both a `PipelineHandler` and a plain handler function.
 * Plain functions are auto-wrapped in `PipelineHandler` by `createRoute()`.
 */
export type ServerRouteInput<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> = Omit<ServerRoute<TConfig>, "handler"> & {
  handler: PipelineHandler | ServerHandler<TConfig>;
};

// ---------------------------------------------------------------------------------------------------------------------

export type ServerResponseBody<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> = SchemaOutput<TConfig["response"], ResponseBodyType>;

export type ResponseKind = "json" | "text" | "void" | "file" | "any";

export type ResponseBodyType =
  // not: object is not allowed, you want object ? add schema !
  // biome-ignore lint/suspicious/noConfusingVoidType: handlers may return void (no return statement)
  string | Buffer | StreamLike | undefined | null | void;

export type ServerHandler<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (request: ServerRequest<TConfig>) => Async<ServerResponseBody<TConfig>>;

export interface ServerResponse {
  body: string | Buffer | ArrayBuffer | NodeStream | NodeWebStream;
  headers: Record<string, string>;
  status: number;
}

export type ServerRouteRequestHandler = (
  request: ServerRequestData,
) => Promise<ServerResponse>;

export interface ServerRouteMatcher extends Route {
  handler: ServerRouteRequestHandler;
}

export interface ServerRequestData {
  readonly method: RouteMethod;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly query: Record<string, string>;
  readonly params: Record<string, string>;
  raw: ServerRawRequest;
}

export interface ServerRawRequest {
  node?: NodeRequestEvent;
  web?: WebRequestEvent;
}

export interface NodeRequestEvent {
  req: IncomingMessage;
  res: NodeServerResponse;
}

export interface WebRequestEvent {
  req: Request;
  res?: Response;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Geolocation information from proxy headers (Cloudflare, Vercel, etc.)
 */
export interface RequestGeo {
  /**
   * ISO 3166-1 alpha-2 country code (e.g., "US", "FR", "JP").
   */
  country?: string;
  /**
   * City name (e.g., "San Francisco", "Paris").
   */
  city?: string;
  /**
   * Region/state (e.g., "California", "Île-de-France").
   */
  region?: string;
  /**
   * Latitude (if available).
   */
  latitude?: string;
  /**
   * Longitude (if available).
   */
  longitude?: string;
}

/**
 * Parsed referer information.
 */
export interface RequestReferer {
  /**
   * Full referer URL.
   */
  url: string;
  /**
   * Hostname of the referer (e.g., "google.com").
   */
  hostname: string;
  /**
   * Path of the referer URL.
   */
  pathname: string;
}
