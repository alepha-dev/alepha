import { KIND } from "@alepha/core";

export const REMOTE_DESCRIPTOR_KEY = "REMOTE";

export interface RemoteDescriptorOptions<T extends object> {
	/**
	 * The URL of the remote service.
	 */
	url: string;

	/**
	 * The API of the remote service.
	 */
	api: T;
}

export interface RemoteDescriptor<T extends object> {
	[KIND]: typeof REMOTE_DESCRIPTOR_KEY;
	options: RemoteDescriptorOptions<T>;
}

export const $remote = <T extends object>(
	options: RemoteDescriptorOptions<T>,
) => {
	return {
		[KIND]: REMOTE_DESCRIPTOR_KEY,
		options,
	} as RemoteDescriptor<T>;
};

$remote[KIND] = REMOTE_DESCRIPTOR_KEY;
