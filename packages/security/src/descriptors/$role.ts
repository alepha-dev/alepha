import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { PermissionDescriptor } from "./$permission.ts";
import type { RealmDescriptor } from "./$realm.ts";

/**
 * Create a new role.
 */
export const $role = (options: RoleDescriptorOptions = {}): RoleDescriptor => {
	return createDescriptor(RoleDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RoleDescriptorOptions {
	/**
	 * Name of the role.
	 */
	name?: string;

	/**
	 * Describe the role.
	 */
	description?: string;

	realm?: string | RealmDescriptor;

	permissions?: Array<
		| string
		| {
				name: string;
				ownership?: boolean;
				exclude?: string[];
		  }
	>;
}

export class RoleDescriptor extends Descriptor<RoleDescriptorOptions> {
	protected readonly securityProvider = $inject(SecurityProvider);

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	protected onInit() {
		this.securityProvider.createRole({
			...this.options,
			name: this.name,
			permissions:
				this.options.permissions?.map((it) => {
					if (typeof it === "string") {
						return {
							name: it,
						};
					}

					return it;
				}) ?? [],
		});
	}

	/**
	 * Get the realm of the role.
	 */
	public get realm(): string | RealmDescriptor | undefined {
		return this.options.realm;
	}

	public can(permission: string | PermissionDescriptor): boolean {
		return this.securityProvider.can(this.name, permission);
	}

	public check(permission: string | PermissionDescriptor) {
		return this.securityProvider.checkPermission(permission, this.name);
	}
}

// ---------------------------------------------------------------------------------------------------------------------

$role[KIND] = RoleDescriptor;
