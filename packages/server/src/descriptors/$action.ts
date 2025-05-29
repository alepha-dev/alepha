import { OPTIONS, type Static, type TSchema } from "@alepha/core";
import { KIND, NotImplementedError, __descriptor } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRoute,
} from "../providers/ServerRouterProvider.ts";

/**
 * Route descriptor options.
 */
export interface RouteDescriptorOptions<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends Omit<ServerRoute, "handler" | "path" | "schema"> {
	/**
	 * Name the route.
	 */
	name?: string;

	/**
	 * Namespace of the route, used for grouping.
	 *
	 * @default Class name containing the route.
	 */
	group?: string;

	/**
	 * If false, disabled the security check for this route.
	 *
	 * @default true when SecurityModule is enabled, false otherwise.
	 */
	security?: boolean;

	/**
	 * Pathname of the route.
	 */
	path?: string;

	/**
	 * Base URL of the route.
	 *
	 * @default "/api"
	 */
	base?: string;

	/**
	 * Inherit options from another route.
	 */
	use?: { [OPTIONS]: RouteDescriptorOptions<TConfig> };

	/**
	 * The route method.
	 *
	 * @default "GET" or "POST" when schema body is defined.
	 */
	method?: RouteMethod;

	/**
	 * The config schema of the route.
	 * - body: The request body schema.
	 * - params: Path variables schema.
	 * - query: The request query-params schema.
	 * - response: The response schema.
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
	 * Disable the route. Useful with env variables do disable one specific route.
	 */
	disabled?: boolean;

	/**
	 * Mark the route as private. It will not be exposed in the API documentation.
	 */
	internal?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 */
	handler?: ServerHandler<TConfig>;
}

export interface RouteDescriptor<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
	[KIND]: "ROUTE";
	[OPTIONS]: RouteDescriptorOptions<TConfig>;

	/**
	 * Fetch or just call local route when available.
	 */
	(
		config?: ClientRequestEntry<TConfig>,
		opts?: ClientRequestOptions,
	): ClientRequestResponse<TConfig>;

	/**
	 * Just fetch the route. Skip any local route.
	 */
	fetch: (
		config?: ClientRequestEntry<TConfig>,
		opts?: ClientRequestOptions,
	) => ClientRequestResponse<TConfig>;

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
export const $route = <TConfig extends RequestConfigSchema>(
	options: RouteDescriptorOptions<TConfig>,
): RouteDescriptor<TConfig> => {
	__descriptor("ROUTE");

	const routeDescriptorOptions = {
		...options.use?.[OPTIONS],
		...options,
	};

	const route = () => {
		throw new NotImplementedError("ROUTE");
	};

	route[KIND] = "ROUTE" as const;
	route[OPTIONS] = routeDescriptorOptions;

	route.fetch = async () => {
		throw new NotImplementedError("ROUTE");
	};

	route.permission = () => {
		throw new NotImplementedError("ROUTE");
	};

	return route;
};

$route[KIND] = "ROUTE";

export const $action = $route;

// ----------------------------------------------------------------------------------------------------------

export type ClientRequestEntry<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
	T = ClientRequestEntryContainer<TConfig>,
> = {
	[K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export type ClientRequestEntryContainer<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = {
	body: TConfig["body"] extends TSchema ? Static<TConfig["body"]> : undefined;

	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: undefined;

	headers?: TConfig["headers"] extends TSchema
		? Static<TConfig["headers"]>
		: undefined;

	query?: TConfig["query"] extends TSchema
		? Partial<Static<TConfig["query"]>>
		: undefined;
};

export interface ClientRequestOptions {
	/**
	 * Built-in cache options.
	 * Number as seconds or boolean to enable cache.
	 */
	cache?: number | boolean;

	/**
	 * Forward user from the previous request.
	 *
	 * In testing environments, you can pass a partial user token.
	 */
	user?: Partial<UserAccountToken>;

	/**
	 * Standard request fetch options.
	 */
	request?: RequestInit;
}

export type ClientRequestResponse<TConfig extends RequestConfigSchema> =
	Promise<
		TConfig["response"] extends TSchema ? Static<TConfig["response"]> : Response
	>;
