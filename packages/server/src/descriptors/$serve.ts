import { __descriptor, KIND } from "@alepha/core";
import type { FastifyStaticOptions } from "@fastify/static";

export const SERVER_DESCRIPTOR_KEY = "SERVE";

export interface ServeDescriptorOptions extends FastifyStaticOptions {}
export interface ServeDescriptor {
	[KIND]: typeof SERVER_DESCRIPTOR_KEY;
	options: ServeDescriptorOptions;
}

export const $serve = (options: ServeDescriptorOptions): ServeDescriptor => {
	__descriptor(SERVER_DESCRIPTOR_KEY);

	return {
		[KIND]: SERVER_DESCRIPTOR_KEY,
		options,
	};
};

$serve[KIND] = SERVER_DESCRIPTOR_KEY;
