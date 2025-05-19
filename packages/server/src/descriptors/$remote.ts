import { type Async, KIND, OPTIONS } from "@alepha/core";
import type { ServerRequest } from "../providers/ServerRouterProvider.ts";

export const REMOTE_DESCRIPTOR_KEY = "REMOTE";

export interface RemoteDescriptorOptions {
	/**
	 * The URL of the remote service.
	 */
	url: string | (() => string);

	/**
	 * @default "/api/_links"
	 */
	linkPath?: string;

	/**
	 * If true, all methods of the remote service will be exposed as actions.
	 */
	proxy?:
		| boolean
		| {
				beforeRequest?: (
					request: ServerRequest,
					proxyRequest: RequestInit,
				) => Async<void>;

				afterResponse?: (
					request: ServerRequest,
					proxyResponse: Response,
				) => Async<void>;

				rewrite?: (url: URL) => void;
		  };

	/**
	 * One or many instance of classes to be registered as remote services.
	 * Services must contain some $action() descriptors.
	 */
	services?: object | Array<object>;

	/**
	 * The name of the remote service.
	 *
	 * @default Member of the class containing the remote service.
	 */
	name?: string;
}

export interface RemoteDescriptor {
	[KIND]: typeof REMOTE_DESCRIPTOR_KEY;
	[OPTIONS]: RemoteDescriptorOptions;
}

export const $remote = (options: RemoteDescriptorOptions) => {
	return {
		[KIND]: REMOTE_DESCRIPTOR_KEY,
		[OPTIONS]: options,
	} as RemoteDescriptor;
};

$remote[KIND] = REMOTE_DESCRIPTOR_KEY;
