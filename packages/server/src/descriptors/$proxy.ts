import { type Async, KIND, OPTIONS, __descriptor } from "@alepha/core";
import type { ServerRequest } from "../providers/ServerRouterProvider.ts";

export type ProxyDescriptorOptions = {
	path: string;

	target: string;

	disabled?: boolean;

	beforeRequest?: (
		request: ServerRequest,
		proxyRequest: RequestInit,
	) => Async<void>;

	afterResponse?: (
		request: ServerRequest,
		proxyResponse: Response,
	) => Async<void>;

	rewrite?: (url: URL) => void;

	// TODO:

	// retry: RetryOptions;
};

export interface ProxyDescriptor {
	[KIND]: "PROXY";
	[OPTIONS]: ProxyDescriptorOptions;
}

export const $proxy = (options: ProxyDescriptorOptions): ProxyDescriptor => {
	__descriptor("PROXY");
	return {
		[KIND]: "PROXY",
		[OPTIONS]: options,
	};
};

$proxy[KIND] = "PROXY";
