import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { JSONWebKeySet } from "jose";
import { SecurityError } from "../errors/SecurityError.ts";
import { JwtProvider } from "../providers/JwtProvider.ts";
import {
	SecurityProvider,
	type SecurityUserAccountProvider,
} from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";

/**
 * Create a new realm.
 */
export const $realm = (
	options: RealmDescriptorOptions = {},
): RealmDescriptor => {
	return createDescriptor(RealmDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RealmDescriptorOptions {
	/**
	 * Define the realm name.
	 *
	 * @default key name
	 */
	name?: string;

	/**
	 * Describe the realm.
	 */
	description?: string;

	/**
	 * All roles available in the realm. Role is a string (role name) or a Role object (embedded role).
	 */
	roles?: Array<string | Role>;

	/**
	 * In order to verify user of the realm, a secret is required.
	 * Can be a string based secret or a JWKS URL.
	 *
	 * Note: You can skip this if you are using a user account provider with JWKS.
	 */
	secret?: string | JSONWebKeySet | (() => string);

	/**
	 * Attach a user account provider to the realm to manage roles.
	 * For example, you can use a KeycloakUserProvider to automatically create realm roles inside Keycloak.
	 */
	userAccountProvider?:
		| SecurityUserAccountProvider
		| (() => SecurityUserAccountProvider);
}

// ---------------------------------------------------------------------------------------------------------------------

export class RealmDescriptor extends Descriptor<RealmDescriptorOptions> {
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly jwt = $inject(JwtProvider);

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	protected onInit() {
		this.securityProvider.createRealm({
			name: this.name,
			secret:
				typeof this.options.secret === "function"
					? this.options.secret()
					: this.options.secret,
			userAccountProvider:
				typeof this.options.userAccountProvider === "function"
					? this.options.userAccountProvider()
					: this.options.userAccountProvider,
			roles:
				this.options.roles?.map((it) => {
					if (typeof it === "string") {
						const role = this.getRoles().find((role) => role.name === it);
						if (!role) {
							throw new SecurityError(`Role '${it}' not found`);
						}
						return role;
					}

					return it;
				}) ?? [],
		});
	}

	/**
	 * Get all roles in the realm.
	 */
	public getRoles(): Role[] {
		return this.securityProvider.getRoles(this.name);
	}

	/**
	 * Set all roles in the realm.
	 */
	public async setRoles(roles: Role[]): Promise<void> {
		await this.securityProvider.updateRealm(this.name, roles);
	}

	/**
	 * Get a role by name, throws an error if not found.
	 */
	public getRoleByName(name: string): Role {
		const role = this.getRoles().find((it) => it.name === name);
		if (!role) {
			throw new SecurityError(`Role '${name}' not found`);
		}
		return role;
	}

	/**
	 * Create a token for the subject.
	 */
	public async createToken(subject: string, roles?: string[]): Promise<string> {
		return this.jwt.create(
			{
				sub: subject,
				roles,
			},
			this.name,
		);
	}
}

$realm[KIND] = RealmDescriptor;
