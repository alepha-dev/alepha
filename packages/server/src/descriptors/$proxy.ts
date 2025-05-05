import { type Async, KIND, __descriptor } from "@alepha/core";
import type { ServerRequest } from "../providers/ServerRouterProvider.ts";

export type ProxyDescriptorOptions = {
	path: string;
	target: string;
	beforeRequest?: (
		request: ServerRequest,
		proxyRequest: RequestInit,
	) => Async<void>;
	afterResponse?: (
		request: ServerRequest,
		proxyResponse: Response,
	) => Async<void>;
};

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
