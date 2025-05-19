import { KIND, OPTIONS } from "@alepha/core";

export const REMOTE_DESCRIPTOR_KEY = "REMOTE";

export interface RemoteDescriptorOptions {
	/**
	 * The URL of the remote service.
	 */
	url: string | (() => string);

	/**
	 * If true, all methods of the remote service will be exposed as actions.
	 */
	proxy?: boolean;

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
