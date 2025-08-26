import {
	$env,
	$hook,
	$inject,
	Alepha,
	AppNotStartedError,
	ContainerLockedError,
	type Static,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { JSONWebKeySet, JWTPayload } from "jose";
import type { JWTVerifyOptions } from "jose/jwt/verify";
import { InvalidPermissionError } from "../errors/InvalidPermissionError.ts";
import { InvalidTokenError } from "../errors/InvalidTokenError.ts";
import { RealmNotFoundError } from "../errors/RealmNotFoundError.ts";
import { SecurityError } from "../errors/SecurityError.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import type { Permission } from "../schemas/permissionSchema.ts";
import type { Role } from "../schemas/roleSchema.ts";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";
import { JwtProvider } from "./JwtProvider.ts";

const envSchema = t.object({
	SECURITY_SECRET_KEY: t.string({ default: "replace-me-with-a-secret-key" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class SecurityProvider {
	protected readonly UNKNOWN_USER_NAME = "Anonymous User";
	protected readonly PERMISSION_REGEXP = /^[\w-]+(:[\w-]+)?$/;
	protected readonly PERMISSION_REGEXP_WILDCARD = /^[\w-]+(:[\w-]+)?|(:\*)$/;

	protected readonly log = $logger();
	protected readonly jwt = $inject(JwtProvider);
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);

	/**
	 * The permissions configured for the security provider.
	 */
	protected readonly permissions: Permission[] = [];

	/**
	 * The realms configured for the security provider.
	 */
	protected readonly realms: Realm[] = [
		{
			name: "default",
			secret: this.env.SECURITY_SECRET_KEY,
			roles: [
				{
					name: "admin",
					permissions: [
						{
							name: "*",
						},
					],
				},
			],
		},
	];

	protected start = $hook({
		on: "start",
		handler: async () => {
			for (const realm of this.realms) {
				if (realm.secret) {
					const secret =
						typeof realm.secret === "function" ? realm.secret() : realm.secret;
					this.jwt.setKeyLoader(realm.name, secret);
				}
			}
		},
	});

	/**
	 * Adds a role to one or more realms.
	 *
	 * @param role
	 * @param realms
	 */
	public createRole(role: Role, ...realms: string[]): Role {
		const list = realms.length
			? realms.map((it) => {
					const item = this.realms.find((realm) => realm.name === it);
					if (!item) {
						throw new RealmNotFoundError(it);
					}
					return item;
				})
			: this.realms;

		for (const realm of list) {
			for (const { name } of role.permissions) {
				if (this.alepha.isStarted()) {
					const parts = name.split(":");
					const existing = this.permissions.find(
						(it) =>
							(parts[0] === it.group && parts[1] === "*") ||
							this.permissionToString(it) === name,
					);
					if (!existing) {
						throw new SecurityError(`Permission '${name}' not found`);
					}
				} else {
					if (name !== "*" && !this.PERMISSION_REGEXP_WILDCARD.test(name)) {
						throw new InvalidPermissionError(name);
					}
				}
			}

			realm.roles.push(role);
		}

		return role;
	}

	/**
	 * Adds a permission to the security provider.
	 *
	 * @param raw - The permission to add.
	 */
	public createPermission(raw: Permission | string): Permission {
		if (this.alepha.isStarted()) {
			throw new ContainerLockedError();
		}

		let permission: Permission;
		if (typeof raw === "string") {
			if (!this.PERMISSION_REGEXP.test(raw)) {
				throw new InvalidPermissionError(raw);
			}

			const parts = raw.split(":");
			if (!parts[1]) {
				permission = { name: parts[0] };
			} else {
				permission = {
					group: parts[0],
					name: parts[1],
				};
			}
		} else {
			permission = raw;
		}

		const asString = this.permissionToString(permission);
		if (!this.PERMISSION_REGEXP.test(asString)) {
			throw new InvalidPermissionError(asString);
		}

		const existing = this.permissions.find(
			(it) => this.permissionToString(it) === asString,
		);

		if (existing) {
			this.log.warn(`Permission '${asString}' already exists. Skipping.`, {
				current: existing,
				new: permission,
			});

			return existing;
		}

		this.log.trace(`Creating permission '${asString}'`);

		this.permissions.push(permission);

		return permission;
	}

	public createRealm(realm: Realm) {
		if (this.realms.length === 1 && this.realms[0].name === "default") {
			// if the default realm is the only one, we remove it to allow creating new realms
			this.realms.pop();
		}

		this.realms.push(realm);
	}

	/**
	 * Updates the roles for a realm then synchronizes the user account provider if available.
	 *
	 * Only available when the app is started.
	 *
	 * @param realm - The realm to update the roles for.
	 * @param roles - The roles to update.
	 */
	public async updateRealm(realm: string, roles: Role[]): Promise<void> {
		if (!this.alepha.isStarted()) {
			throw new AppNotStartedError();
		}

		const realmInstance = this.realms.find((it) => it.name === realm);
		if (!realmInstance) {
			throw new RealmNotFoundError(realm);
		}

		realmInstance.roles = roles;
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Creates a user account from the provided payload.
	 *
	 * @param payload - The payload to create the user account from.
	 * @param [realmName] - The realm containing the roles. Default is all.
	 *
	 * @returns The user info created from the payload.
	 */
	public createUserFromPayload(
		payload: JWTPayload,
		realmName?: string,
	): UserAccount {
		const id = this.getIdFromPayload(payload);
		const sessionId = this.getSessionIdFromPayload(payload);
		const rolesFromPayload = this.getRolesFromPayload(payload);
		const email = this.getEmailFromPayload(payload);
		const username = this.getUsernameFromPayload(payload);
		const picture = this.getPictureFromPayload(payload);
		const name = this.getNameFromPayload(payload);
		const organizations = this.getOrganizationsFromPayload(payload);
		const rolesFromSystem = this.getRoles(realmName);
		const roles = rolesFromPayload
			.reduce<Role[]>(
				(arr, roleName) =>
					arr.concat(rolesFromSystem.filter((it) => it.name === roleName)),
				[],
			)
			.map((it) => it.name);

		const realm = this.realms.find((it) => it.name === realmName);
		if (realm?.profile) {
			return realm.profile(payload);
		}

		return {
			id,
			roles,
			name,
			email,
			username,
			picture,
			organizations,
			sessionId,
		};
	}

	/**
	 * Checks if the user has the specified permission.
	 *
	 * Bonus: we check also if the user has "ownership" flag.
	 *
	 * @param permissionLike - The permission to check for.
	 * @param roleEntries - The roles to check for the permission.
	 */
	public checkPermission(
		permissionLike: string | Permission,
		...roleEntries: string[]
	): SecurityCheckResult {
		const roles: Role[] = roleEntries.map((it) => {
			const role = this.getRoles().find((role) => role.name === it);
			if (!role) {
				throw new SecurityError(`Role '${it}' not found`);
			}
			return role;
		});

		const permission = this.permissionToString(permissionLike);
		const isAdmin = roles.find((it) =>
			it.permissions.find(
				(it) => it.name === "*" && !it.exclude && !it.ownership,
			),
		);

		// if the user is an admin, we can return early
		if (isAdmin) {
			return {
				isAuthorized: true,
				ownership: false,
			};
		}

		const result: SecurityCheckResult = {
			isAuthorized: false,
			ownership: undefined,
		};

		// check if the user has the permission
		const [group] = permission.split(":");
		const groupWildcard = `${group}:*`;

		for (const role of roles) {
			// for each role candidate
			for (const rolePermission of role.permissions) {
				// for each permission in the role
				if (
					rolePermission.name === "*" || // if permission is * (wildcard)
					rolePermission.name === groupWildcard || // if permission is group:* (wildcard)
					rolePermission.name === permission // or if permission is the exact permission
				) {
					// [feature]: exclude permissions
					// TODO: exclude ["group:*"]
					if (rolePermission.exclude?.includes(permission)) {
						// if permission is excluded, we can skip it
						continue;
					}

					result.isAuthorized = true; // OK !

					// but we also need to check if the user has ownership
					if (rolePermission.ownership) {
						// if ownership is true, we have to check all other matching permissions in case of ownership === false ...
						result.ownership = rolePermission.ownership;
					} else {
						// but if isAuthorized && ownership === false, we can break the loop \ :D /
						result.ownership = false;
						return result;
					}
				}
			}
		}

		return result;
	}

	/**
	 * Creates a user account from the provided payload.
	 *
	 * @param headerOrToken
	 * @param permissionLike
	 */
	public async createUserFromToken(
		headerOrToken?: string,
		options: {
			permission?: Permission | string;
			realm?: string;
			verify?: JWTVerifyOptions;
		} = {},
	): Promise<UserAccountToken> {
		const token = headerOrToken?.replace("Bearer", "").trim();
		if (typeof token !== "string" || token === "") {
			throw new InvalidTokenError(
				"Invalid authorization header, maybe token is missing ?",
			);
		}

		const { result, keyName: realm } = await this.jwt.parse(
			token,
			options.realm,
			options.verify,
		);

		const info = this.createUserFromPayload(result.payload, realm);
		const realmRoles = this.getRoles(realm).filter((it) => it.default);
		const roles = info.roles ?? [];

		for (const role of realmRoles) {
			if (!roles.includes(role.name)) {
				roles.push(role.name);
			}
		}

		info.roles = roles;

		await this.alepha.emit("security:user:created", {
			realm,
			user: info,
		});

		let ownership: string | boolean | undefined;

		if (options.permission) {
			const check = this.checkPermission(options.permission, ...roles);
			if (!check.isAuthorized) {
				throw new SecurityError(
					`User is not allowed to access '${this.permissionToString(options.permission)}'`,
				);
			}

			ownership = check.ownership;
		}

		return {
			...info,
			ownership,
			token,
			realm,
		};
	}

	/**
	 * Checks if a user has a specific role.
	 *
	 * @param roleName - The role to check for.
	 * @param permission - The permission to check for.
	 * @returns True if the user has the role, false otherwise.
	 */
	public can(roleName: string, permission: string | Permission): boolean {
		return this.checkPermission(permission, roleName).isAuthorized;
	}

	/**
	 * Checks if a user has ownership of a specific permission.
	 */
	public ownership(
		roleName: string,
		permission: string | Permission,
	): string | boolean | undefined {
		return this.checkPermission(permission, roleName).ownership;
	}

	/**
	 * Converts a permission object to a string.
	 *
	 * @param permission
	 */
	public permissionToString(permission: Permission | string): string {
		if (typeof permission === "string") {
			return permission;
		}

		if (!permission.group) {
			return permission.name;
		}

		return `${permission.group}:${permission.name}`;
	}

	// accessors

	public getRealms(): Realm[] {
		return this.realms;
	}

	/**
	 * Retrieves the user account from the provided user ID.
	 *
	 * @param realm
	 */
	public getRoles(realm?: string): Role[] {
		if (realm) {
			return [...(this.realms.find((it) => it.name === realm)?.roles ?? [])];
		}

		return this.realms.reduce<Role[]>((arr, it) => arr.concat(it.roles), []);
	}

	/**
	 * Returns all permissions.
	 *
	 * @param user - Filter permissions by user.
	 *
	 * @return An array containing all permissions.
	 */
	public getPermissions(user?: {
		roles?: Array<Role | string>;
		realm?: string;
	}): Permission[] {
		if (user?.roles) {
			const permissions: Permission[] = [];
			const roles = user.roles ?? [];

			for (const roleOrString of roles) {
				const role =
					typeof roleOrString === "string"
						? this.getRoles(user.realm).find((it) => it.name === roleOrString)
						: roleOrString;

				if (!role) {
					throw new SecurityError(`Role '${roleOrString}' not found`);
				}

				if (role.permissions.some((it) => it.name === "*" && !it.exclude)) {
					return this.getPermissions();
				}

				for (const permission of role.permissions) {
					let ref: Permission[] = [];
					if (permission.name === "*") {
						ref.push(...this.permissions);
					} else if (permission.name.includes(":")) {
						const [group, name] = permission.name.split(":");

						// all permissions in the group
						if (name === "*") {
							ref.push(...this.permissions.filter((it) => it.group === group));
						} else {
							// specific permission
							ref.push(
								...this.permissions.filter(
									(it) => it.name === name && it.group === group,
								),
							);
						}
					} else {
						// all permissions without a group
						ref.push(
							...this.permissions.filter(
								(it) => it.name === permission.name && !it.group,
							),
						);
					}
					const exclude = permission.exclude;
					if (exclude) {
						// exclude permissions
						ref = ref.filter(
							(it) => !exclude.includes(this.permissionToString(it)),
						);
					}
					permissions.push(...ref);
				}
			}

			return [...new Set(permissions.filter((it) => it != null))];
		}

		return this.permissions;
	}

	/**
	 * Retrieves the user ID from the provided payload object.
	 *
	 * @param payload - The payload object from which to extract the user ID.
	 * @return The user ID as a string.
	 */
	public getIdFromPayload(payload: Record<string, any>): string {
		if (payload.sub != null) {
			return String(payload.sub);
		}

		if (payload.id != null) {
			return String(payload.id);
		}

		if (payload.userId != null) {
			return String(payload.userId);
		}

		throw new SecurityError("Invalid JWT - missing id");
	}

	public getSessionIdFromPayload(
		payload: Record<string, any>,
	): string | undefined {
		if (!payload) {
			return;
		}
		if (payload.sid) {
			return String(payload.sid);
		}
	}

	/**
	 * Retrieves the roles from the provided payload object.
	 * @param payload - The payload object from which to extract the roles.
	 * @return An array of role strings.
	 */
	public getRolesFromPayload(payload: Record<string, any>): string[] {
		return payload?.realm_access?.roles ?? payload?.roles ?? [];
	}

	public getPictureFromPayload(
		payload: Record<string, any>,
	): string | undefined {
		if (!payload) {
			return;
		}

		if (payload.picture) {
			return payload.picture;
		}

		if (payload.avatar_url) {
			return payload.avatar_url;
		}

		if (payload.user_picture) {
			return payload.user_picture;
		}

		return undefined;
	}

	public getUsernameFromPayload(
		payload: Record<string, any>,
	): string | undefined {
		if (!payload) {
			return;
		}

		if (payload.preferred_username) {
			return payload.preferred_username;
		}

		if (payload.username) {
			return payload.username;
		}

		return undefined;
	}

	public getEmailFromPayload(payload: Record<string, any>): string | undefined {
		if (!payload) {
			return;
		}

		if (payload.email) {
			return payload.email;
		}

		return undefined;
	}

	/**
	 * Returns the name from the given payload.
	 *
	 * @param payload - The payload object.
	 * @returns The name extracted from the payload, or an empty string if the payload is falsy or no name is found.
	 */
	public getNameFromPayload(payload: Record<string, any>): string {
		if (!payload) {
			return this.UNKNOWN_USER_NAME;
		}

		if (payload.name) {
			return payload.name;
		}

		if (
			typeof payload.given_name === "string" &&
			typeof payload.family_name === "string"
		) {
			return `${payload.given_name} ${payload.family_name}`.trim();
		}

		return this.UNKNOWN_USER_NAME;
	}

	public getOrganizationsFromPayload(
		payload: Record<string, any>,
	): string[] | undefined {
		if (!payload) {
			return;
		}

		if (payload.organization) {
			if (typeof payload.organization === "string") {
				return [payload.organization];
			}
			if (Array.isArray(payload.organization)) {
				return payload.organization;
			}
		}
	}
}

// =====================================================================================================================

/**
 * A realm definition.
 */
export interface Realm {
	name: string;

	roles: Role[];

	/**
	 * The secret key for the realm.
	 *
	 * Can be also a JWKS URL.
	 */
	secret?: string | JSONWebKeySet | (() => string);

	/**
	 * Create the user account info based on the raw JWT payload.
	 * By default, SecurityProvider has his own implementation, but this method allow to override it.
	 */
	profile?: (raw: Record<string, any>) => UserAccount;
}

export interface SecurityCheckResult {
	isAuthorized: boolean;
	ownership: string | boolean | undefined;
}
