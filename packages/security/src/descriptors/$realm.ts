import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import {
	DateTimeProvider,
	type Duration,
	type DurationLike,
} from "@alepha/datetime";
import type { JSONWebKeySet, JWTPayload } from "jose";
import { SecurityError } from "../errors/SecurityError.ts";
import { JwtProvider } from "../providers/JwtProvider.ts";
import {
	SecurityProvider,
	type SecurityUserAccountProvider,
} from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";
import type { UserAccountInfo } from "../schemas/userAccountInfoSchema.ts";

/**
 * Create a new realm.
 */
export const $realm = (options: RealmDescriptorOptions): RealmDescriptor => {
	return createDescriptor(RealmDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type RealmDescriptorOptions = {
	/**
	 * Define the realm name.
	 * If not provided, it will use the property key.
	 */
	name?: string;

	/**
	 * Short description about the realm.
	 */
	description?: string;

	/**
	 * All roles available in the realm. Role is a string (role name) or a Role object (embedded role).
	 */
	roles?: Array<string | Role>;

	settings?: RealmSettings;

	/**
	 * Parse the JWT payload to create a user account info.
	 */
	profile?: (jwtPayload: Record<string, any>) => UserAccountInfo;
} & (RealmInternal | RealmExternal);

export interface RealmSettings {
	accessToken?: {
		/**
		 * Lifetime of the access token.
		 * @default 15 minutes
		 */
		expiration?: DurationLike;
	};

	refreshToken?: {
		/**
		 * Lifetime of the refresh token.
		 * @default 30 days
		 */
		expiration?: DurationLike;

		/**
		 * If true, no refresh token will be created.
		 */
		disabled?: boolean;

		create?: (
			user: UserAccountInfo,
			refreshToken?: string,
		) => Promise<{
			refresh_token: string;
			expires_in: number;
		}>;
	};
}

export type RealmInternal = {
	/**
	 * Internal secret to sign JWT tokens and verify them.
	 */
	secret: string;
};

export interface RealmExternal {
	/**
	 * URL to the JWKS (JSON Web Key Set) to verify JWT tokens from external providers.
	 */
	jwks: (() => string) | JSONWebKeySet;

	/**
	 * Attach a user account provider to the realm to manage roles.
	 *
	 * For example, you can use a KeycloakUserProvider to automatically create/update realm roles inside Keycloak.
	 */
	userAccountProvider?:
		| SecurityUserAccountProvider
		| (() => SecurityUserAccountProvider);
}

// ---------------------------------------------------------------------------------------------------------------------

export class RealmDescriptor extends Descriptor<RealmDescriptorOptions> {
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly jwt = $inject(JwtProvider);

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	public get accessTokenExpiration(): Duration {
		return this.dateTimeProvider.duration(
			this.options.settings?.accessToken?.expiration ?? [15, "minutes"],
		);
	}

	public get refreshTokenExpiration(): Duration {
		return this.dateTimeProvider.duration(
			this.options.settings?.refreshToken?.expiration ?? [30, "days"],
		);
	}

	protected onInit() {
		const roles =
			this.options.roles?.map((it) => {
				if (typeof it === "string") {
					const role = this.getRoles().find((role) => role.name === it);
					if (!role) {
						throw new SecurityError(`Role '${it}' not found`);
					}
					return role;
				}

				return it;
			}) ?? [];

		if ("jwks" in this.options) {
			this.securityProvider.createRealm({
				name: this.name,
				profile: this.options.profile,
				secret: this.options.jwks,
				userAccountProvider:
					typeof this.options.userAccountProvider === "function"
						? this.options.userAccountProvider()
						: this.options.userAccountProvider,
				roles,
			});
		} else {
			this.securityProvider.createRealm({
				name: this.name,
				profile: this.options.profile,
				secret: this.options.secret,
				roles,
			});
		}
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

	public async parseToken(token: string): Promise<JWTPayload> {
		const { result } = await this.jwt.parse(token, this.name);
		return result.payload;
	}

	/**
	 * Create a token for the subject.
	 */
	public async createToken(
		user: UserAccountInfo,
		refreshToken?: string,
	): Promise<AccessTokenResponse> {
		const refreshTokenEnabled =
			this.options.settings?.refreshToken?.disabled !== false;

		const iat = this.dateTimeProvider.now().unix();
		const exp = iat + this.accessTokenExpiration.asSeconds();

		const { id: sub, ...rest } = user;

		const access_token = await this.jwt.create(
			{
				sub,
				exp,
				iat,
				aud: this.name,
				...rest,
			},
			this.name,
		);

		const response: AccessTokenResponse = {
			access_token,
			token_type: "Bearer",
			expires_in: this.accessTokenExpiration.asSeconds(),
			issued_at: iat,
		};

		if (refreshTokenEnabled) {
			// handle session by yourself
			const create = this.options.settings?.refreshToken?.create;
			if (create) {
				const { refresh_token, expires_in } = await create(user, refreshToken);
				response.refresh_token = refresh_token;
				response.refresh_token_expires_in = expires_in;
			} else if (refreshToken) {
				const payload = await this.parseToken(refreshToken);
				if (payload.typ !== "refresh") {
					throw new SecurityError(
						`Token type mismatch: expected 'refresh', got '${payload.typ}'`,
					);
				}
				if (payload.sub !== user.id) {
					throw new SecurityError(
						`Refresh token subject mismatch: expected '${user.id}', got '${payload.sub}'`,
					);
				}
				response.refresh_token = refreshToken;
				if (payload.exp) {
					response.refresh_token_expires_in = payload.exp - iat;
				}
			} else {
				response.refresh_token_expires_in =
					this.refreshTokenExpiration.asSeconds();
				response.refresh_token = await this.jwt.create(
					{
						sub: user.id,
						exp: iat + this.refreshTokenExpiration.asSeconds(),
						iat,
						aud: this.name,
						typ: "refresh",
					},
					this.name,
				);
			}
		}

		return response;
	}
}

$realm[KIND] = RealmDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface CreateTokenOptions {
	sub: string;
	roles?: string[];
	email?: string;
}

export interface AccessTokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	issued_at: number;
	refresh_token?: string;
	refresh_token_expires_in?: number;
	scope?: string;
}
