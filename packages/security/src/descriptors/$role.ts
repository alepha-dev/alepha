import { __descriptor, KIND, NotImplementedError } from "@alepha/core";
import type { Role } from "../schemas/roleSchema";

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

	/**
	 *
	 */
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
	options: RoleDescriptorOptions;

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
	role.options = options;

	return role;
};

$role[KIND] = KEY;
