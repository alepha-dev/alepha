import { createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { RequestConfigSchema, ServerRoute } from "../interfaces/index.ts";

/**
 * Create a basic endpoint.
 *
 * It's a low level descriptor. You probably want to use `$action` instead.
 *
 * @see {@link $action}
 * @see {@link $page}
 */
export const $route = <TConfig extends RequestConfigSchema>(
	options: RouteDescriptorOptions<TConfig>,
): RouteDescriptor<TConfig> => {
	return createDescriptor(RouteDescriptor<TConfig>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RouteDescriptorOptions<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRoute<TConfig> {}

// ---------------------------------------------------------------------------------------------------------------------

export class RouteDescriptor<
	TConfig extends RequestConfigSchema,
> extends Descriptor<RouteDescriptorOptions<TConfig>> {}

$route[KIND] = RouteDescriptor;
