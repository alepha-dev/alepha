import { KIND, __descriptor } from "@alepha/core";
import type { fastifyHttpProxy } from "@fastify/http-proxy";

export type ProxyDescriptorOptions = Parameters<typeof fastifyHttpProxy>[1];

export interface ProxyDescriptor {
	[KIND]: "PROXY";
	options: ProxyDescriptorOptions;
}

export const $proxy = (options: ProxyDescriptorOptions): ProxyDescriptor => {
	__descriptor("PROXY");
	return {
		[KIND]: "PROXY",
		options,
	};
};

$proxy[KIND] = "PROXY";
