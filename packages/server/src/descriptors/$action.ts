import { OPTIONS, type Static, type TSchema } from "@alepha/core";
import { KIND, NotImplementedError, __descriptor } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRoute,
} from "../providers/ServerRouterProvider.ts";

const KEY = "ACTION";

export interface ActionDescriptorOptions<
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
	 * @deprecated
	 */
	security?: boolean;

	/**
	 * If true, the route is secure.
	 *
	 * Can be a string or an array of strings to specify required roles or permissions.
	 */
	secure?: boolean | string | string[];

	/**
	 * Pathname of the route.
	 */
	path?: string;

	/**
	 * Inherit options from another route.
	 */
	use?: { [OPTIONS]: ActionDescriptorOptions<TConfig> };

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
	 * Mark the route as private.
	 * - It won't be exposed in the API documentation.
	 * - It won't be exposed in _links.
	 */
	internal?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 */
	handler?: ServerHandler<TConfig>;
}

export interface ActionDescriptor<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: ActionDescriptorOptions<TConfig>;

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

export const $action = <TConfig extends RequestConfigSchema>(
	options: ActionDescriptorOptions<TConfig>,
): ActionDescriptor<TConfig> => {
	__descriptor(KEY);

	const routeDescriptorOptions = {
		...options.use?.[OPTIONS],
		...options,
	};

	const action: ActionDescriptor<TConfig> = () => {
		throw new NotImplementedError(KEY);
	};

	action[KIND] = KEY;
	action[OPTIONS] = routeDescriptorOptions;

	action.fetch = async () => {
		throw new NotImplementedError(KEY);
	};

	action.permission = () => {
		throw new NotImplementedError(KEY);
	};

	return action;
};

$action[KIND] = KEY;

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
