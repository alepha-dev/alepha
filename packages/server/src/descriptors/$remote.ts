import { type Async, KIND, OPTIONS, __descriptor } from "@alepha/core";
import type { ProxyDescriptorOptions } from "./$proxy.ts";

const KEY = "REMOTE";

export interface RemoteDescriptorOptions {
	/**
	 * The URL of the remote service.
	 */
	url: string | (() => string);

	/**
	 * The name of the remote service.
	 *
	 * @default Member of the class containing the remote service.
	 */
	name?: string;

	/**
	 * If true, all methods of the remote service will be exposed as actions.
	 */
	proxy?: boolean | ProxyDescriptorOptions;

	token?: () => Async<string>;

	/**
	 * @default "/api/_links"
	 */
	linkPath?: string;
}

export interface RemoteDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: RemoteDescriptorOptions;
}

export const $remote = (options: RemoteDescriptorOptions) => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
	} as RemoteDescriptor;
};

$remote[KIND] = KEY;
