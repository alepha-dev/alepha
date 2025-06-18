import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";
import type { JSONWebKeySet } from "jose";
import type { SecurityUserAccountProvider } from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";

const KEY = "REALM";

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

export interface RealmDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: RealmDescriptorOptions;

	/**
	 * Get all roles in the realm.
	 */
	getRoles(): Role[];

	/**
	 * Set all roles in the realm.
	 */
	setRoles(roles: Role[]): Promise<void>;

	/**
	 * Get a role by name, throws an error if not found.
	 */
	getRoleByName(name: string): Role;

	/**
	 * Create a token for the subject.
	 */
	createToken(subject: string, roles?: string[]): Promise<string>;
}

export const $realm = (
	options: RealmDescriptorOptions = {},
): RealmDescriptor => {
	__descriptor(KEY);

	const $: RealmDescriptor = () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;

	$.getRoles = () => {
		throw new NotImplementedError(KEY);
	};

	$.getRoleByName = () => {
		throw new NotImplementedError(KEY);
	};

	$.setRoles = () => {
		throw new NotImplementedError(KEY);
	};

	$.createToken = () => {
		throw new NotImplementedError(KEY);
	};

	return $;
};

$realm[KIND] = KEY;
