import { type Async, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";

export const $proxy = (options: ProxyDescriptorOptions): ProxyDescriptor => {
	return createDescriptor(ProxyDescriptor, options);
};

export type ProxyDescriptorOptions = {
	path: string;

	target: string | (() => string);

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

export class ProxyDescriptor extends Descriptor<ProxyDescriptorOptions> {}

$proxy[KIND] = ProxyDescriptor;
