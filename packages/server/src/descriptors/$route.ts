import type { Readable } from "node:stream";
import type { Async, Static, TSchema } from "@alepha/core";
import { KIND, NotImplementedError, __descriptor } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { CookieManager } from "../helpers/CookieManager";
import type { HeaderManager } from "../helpers/HeaderManager.ts";

/**
 * Route descriptor options.
 */
export interface RouteDescriptorOptions<
	TConfig extends RequestConfig = RequestConfig,
	TSecure extends boolean = boolean,
> {
	/**
	 * Rename the route.
	 *
	 * @default Member of the class containing the route.
	 */
	name?: string;

	/**
	 * Namespace of the route, used for grouping.
	 *
	 * @default Class name containing the route.
	 */
	group?: string;

	/**
	 * If true, skip logging for this route.
	 */
	silent?: boolean;

	/**
	 * Pathname of the route.
	 */
	url?: string | "*";

	/**
	 * Inherit options from another route.
	 */
	use?: { options: RouteDescriptorOptions<TConfig, TSecure> };

	/**
	 * The route method.
	 *
	 * @default "GET" or "POST" when schema body is defined.
	 */
	method?: RouteMethod;

	/**
	 * The content type of the request.
	 */
	parse?: "application/json" | "multipart/form-data";

	/**
	 * The config schema of the route.
	 * - body: The request body schema.
	 * - params: Path variables schema.
	 * - query: The request query-params schema.
	 * - response: The response schema.
	 * - headers: The request headers schema.
	 */
	schema?: TConfig;

	/**
	 * Short description of the route.
	 */
	summary?: string;

	/**
	 * Long description of the route.
	 */
	description?: string;

	/**
	 * Turn off security for this route, when Security is enabled.
	 *
	 * @default true
	 */
	security?: TSecure; // TODO: rename to `public: true`

	/**
	 * Disable the route. Useful with env variables do disable one specific route.
	 */
	disabled?: boolean;

	/**
	 * Mark the route as private. It will not be exposed in the API documentation.
	 */
	internal?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 *
	 * @param args
	 * @param ctx
	 */
	handler?: (
		args: RouteRequestArgs<TConfig> & AdditionalRouteArgs<TSecure>,
		ctx: RouteContext,
	) => TConfig["response"] extends ValidResponseStatus
		? StaticResponseStatus<TConfig["response"]>
		: TConfig["response"] extends TSchema
			? Static<TConfig["response"]> | Promise<Static<TConfig["response"]>>
			: Async<
					| string
					| Buffer
					| Readable
					| NodeJS.ReadableStream
					| Response
					| undefined
					| void
				>;
}

export type ValidResponseStatus = {
	200?: TSchema;
	201?: TSchema;
	204?: TSchema;
};

export type StaticResponseStatus<T extends ValidResponseStatus> =
	T[200] extends TSchema
		? Async<Static<T[200]>>
		: T[201] extends TSchema
			? Async<Static<T[201]>>
			: T[204] extends TSchema
				? Async<Static<T[204]>>
				: never;

export type RouteRequestEntry<T extends RouteRequestArgs> = Partial<
	Omit<T, "body" | "params">
> &
	Omit<T, "headers" | "query">;

/**
 * A route definition.
 */
export interface RouteDescriptor<
	TConfig extends RequestConfig = any,
	TSecure extends boolean = boolean,
> {
	[KIND]: "ROUTE";
	options: RouteDescriptorOptions<TConfig, TSecure>;

	(
		config?: RouteRequestEntry<RouteRequestArgs<TConfig>>,
		opts?: RouteGenericRequestOptions,
	): RouteResponse<TConfig>;

	/**
	 * Fetch the route.
	 *
	 * @param config
	 * @param opts
	 */
	fetch: (
		config?: RouteRequestArgs<TConfig>,
		opts?: RouteFetchRequestOptions,
	) => RouteResponse<TConfig>;

	/**
	 * Name of the permission required to access this route.
	 */
	permission: () => string;
}

/**
 * Declare a new route.
 *
 * ```ts
 * class A {
 *   hello = $route({
 *     url: "/hello",
 *     handler: () => "Hello, World!",
 *   });
 * }
 * ```
 *
 * @param options The route options.
 * @returns The route.
 */
export const $route = <
	TConfig extends RequestConfig,
	TSecure extends boolean = true,
>(
	options: RouteDescriptorOptions<TConfig, TSecure>,
): RouteDescriptor<TConfig, TSecure> => {
	__descriptor("ROUTE");

	const routeDescriptorOptions = {
		...options.use?.options,
		...options,
	};

	if (options.use?.options) {
		// when using another route, disable the route by default
		// useful only when a controller use another one
		options.use.options.disabled = true;
	}

	const route = () => {
		throw new NotImplementedError("ROUTE");
	};

	route[KIND] = "ROUTE" as const;
	route.options = routeDescriptorOptions;

	route.fetch = async () => {
		throw new NotImplementedError("ROUTE");
	};

	route.permission = () => {
		throw new NotImplementedError("ROUTE");
	};

	return route;
};

$route[KIND] = "ROUTE";

export interface RequestConfig {
	body?: TSchema;
	params?: TSchema;
	query?: TSchema;
	response?: TSchema | { 200: TSchema } | { 201: TSchema } | { 204: TSchema };
}

/**
 * Route methods.
 */
export const routeMethods = [
	"get",
	"post",
	"put",
	"delete",
	"patch",
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"PATCH",
] as const;

/**
 * Route method type.
 */
export type RouteMethod = (typeof routeMethods)[number];

export interface RouteContext {
	env?: string;
	// will be populated by the server provider
	// fastify {}
	// ...
}

/**
 *
 */
export interface AdditionalRouteArgs<TSecure extends boolean = true> {
	/**
	 * URL of the request.
	 */
	url: URL;

	/**
	 * Headers from the request and response.
	 */
	headers: HeaderManager;

	/**
	 * User token from the request.
	 *
	 * - `SERVER_SECURITY_ENABLED` must be true.
	 * - Can be undefined if the route is public.
	 */
	user: TSecure extends false ? UserAccountToken | undefined : UserAccountToken;

	/**
	 * Read or write cookies from the request.
	 *
	 * - Should be used with `$cookie()`.
	 *
	 * > Note: Not compatible with `fetch()`.
	 */
	cookies: CookieManager;
}

/**
 *
 */
export type RouteHandlerArgs = RouteRequestArgs & AdditionalRouteArgs;

/**
 *
 */
export type RouteHandler = (
	args: RouteHandlerArgs,
	ctx: RouteContext,
) => Promise<any> | any;

/**
 * Map RequestConfig to request arguments.
 */
export type RouteRequestArgs<TConfig extends RequestConfig = RequestConfig> = {
	[K in keyof Omit<TConfig, "response">]: TConfig[K] extends TSchema
		? Static<TConfig[K]>
		: K extends "body"
			? any
			: Record<string, string>;
};

/**
 * Map RequestConfig to response.
 */
export type RouteResponse<TConfig extends RequestConfig> = Promise<
	TConfig["response"] extends { 200: TSchema }
		? Static<TConfig["response"][200]>
		: TConfig["response"] extends TSchema
			? Static<TConfig["response"]>
			: Response
>;

/**
 *
 */
export interface RouteGenericRequestOptions {
	/**
	 * Force the route to be fetched.
	 */
	fetch?: RouteFetchRequestOptions;

	/**
	 * Forward user from the previous request.
	 *
	 * In testing environments, you can pass a partial user token.
	 */
	user?: Partial<UserAccountToken>;

	/**
	 * Forward cookies from the previous request.
	 */
	cookies?: CookieManager;
}

/**
 *
 */
export interface RouteFetchRequestOptions {
	/**
	 *
	 */
	bearer?: string | (() => Async<string>);

	/**
	 * Built-in cache options.
	 */
	cache?: number | boolean;

	/**
	 * Standard request fetch options.
	 */
	request?: RequestInit;

	/**
	 * Test options.
	 *
	 * Only used for testing.
	 */
	test?: {
		/**
		 * Do not throw on error responses, just return the json error.
		 */
		safe?: boolean;

		/**
		 * Create a token with the given user id.
		 */
		userId?: string;

		/**
		 * Create a token with the given roles.
		 */
		roles?: string[];
	};
}
