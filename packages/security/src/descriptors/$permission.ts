import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";
import type { UserAccountInfo } from "../interfaces/UserAccountInfo.ts";
import type { Permission } from "../schemas/permissionSchema.ts";

const KEY = "PERMISSION";

/**
 *
 */
export const $permission = (
	options: PermissionDescriptorOptions = {},
): PermissionDescriptor => {
	__descriptor(KEY);

	const $: PermissionDescriptor = () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;
	$.can = () => {
		throw new NotImplementedError(KEY);
	};

	return $;
};

$permission[KIND] = KEY;

export interface PermissionDescriptorOptions {
	/**
	 * Name of the permission. Use Property name is not provided.
	 */
	name?: string;

	/**
	 * Group of the permission. Use Class name is not provided.
	 */
	group?: string;

	/**
	 * Describe the permission.
	 */
	description?: string;

	/**
	 * HTTP method of the permission. When available.
	 */
	method?: string;

	/**
	 * URL of the permission. When available.
	 */
	url?: string;
}

export interface PermissionDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: PermissionDescriptorOptions;

	/**
	 * Get the permission object.
	 */
	(): Permission;

	/**
	 * Check if the user has the permission.
	 */
	can(user: UserAccountInfo): boolean;
}
