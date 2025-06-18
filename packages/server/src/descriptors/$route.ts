import { __descriptor, KIND, OPTIONS } from "@alepha/core";
import type {
	RequestConfigSchema,
	ServerRoute,
} from "../providers/ServerRouterProvider.ts";

const KEY = "ROUTE";

export interface RouteDescriptorOptions<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRoute<TConfig> {}

export type RouteDescriptor<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = {
	[KIND]: typeof KEY;
	[OPTIONS]: RouteDescriptorOptions<TConfig>;
};

export const $route = <
	TConfig extends RequestConfigSchema = RequestConfigSchema,
>(
	options: RouteDescriptorOptions<TConfig>,
): RouteDescriptor<TConfig> => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
	};
};

$route[KIND] = KEY;
