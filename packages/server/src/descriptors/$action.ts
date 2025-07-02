import {
	__descriptor,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRoute,
} from "../interfaces/index.ts";
import type { FetchResponse, FetchRunOptions } from "../services/HttpClient.ts";

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
	): Promise<ClientRequestResponse<TConfig>>;

	/**
	 * Just fetch the route. Skip any local route.
	 */
	fetch: (
		config?: ClientRequestEntry<TConfig>,
		opts?: ClientRequestOptions,
	) => Promise<FetchResponse<ClientRequestResponse<TConfig>>>;

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

	const action: Partial<ActionDescriptor<TConfig>> = () => {
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

	return action as ActionDescriptor<TConfig>;
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

export interface ClientRequestOptions extends FetchRunOptions {
	/**
	 * Forward user from the previous request.
	 * If "system", use system user. @see {ServerSecurityProvider.localSystemUser}
	 * If "context", use the user from the current context (e.g. request).
	 *
	 * @default "system" is provided, else "context" is used.
	 */
	user?: UserAccountToken | "system" | "context";

	/**
	 * Standard request fetch options.
	 */
	request?: RequestInit;
}

export type ClientRequestResponse<TConfig extends RequestConfigSchema> =
	TConfig["response"] extends TSchema ? Static<TConfig["response"]> : any;
