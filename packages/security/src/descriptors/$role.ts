import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";
import type { Role } from "../schemas/roleSchema.ts";

const KEY = "ROLE";

export interface RoleDescriptorOptions {
	/**
	 * Name of the role.
	 */
	name?: string;

	/**
	 * Describe the role.
	 */
	description?: string;

	permissions?: Array<
		| string
		| {
				name: string;
				ownership?: boolean;
		  }
	>;
}

export interface RoleDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: RoleDescriptorOptions;

	/**
	 * Get the role object.
	 */
	(): Role;
}

export const $role = (options: RoleDescriptorOptions = {}): RoleDescriptor => {
	__descriptor(KEY);

	const role: RoleDescriptor = () => {
		throw new NotImplementedError(KEY);
	};

	role[KIND] = KEY;
	role[OPTIONS] = options;

	return role;
};

$role[KIND] = KEY;
