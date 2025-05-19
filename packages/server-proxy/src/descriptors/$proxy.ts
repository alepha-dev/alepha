import { type Async, KIND, OPTIONS, __descriptor } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";

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
	disabled?: boolean;
	rewrite?: (url: URL) => void;
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
