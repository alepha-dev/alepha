import {
	$inject,
	$logger,
	AlephaError,
	createDescriptor,
	Descriptor,
	KIND,
} from "@alepha/core";
import {
	DateTimeProvider,
	type Duration,
	type DurationLike,
} from "@alepha/datetime";
import type { JSONWebKeySet, JWTPayload } from "jose";
import { SecurityError } from "../errors/SecurityError.ts";
import { JwtProvider } from "../providers/JwtProvider.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

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
	profile?: (jwtPayload: Record<string, any>) => UserAccount;
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

		// TODO: expirationIdle (max inactive time before the token is invalidated)

		/**
		 * If true, no refresh token will be created.
		 */
		disabled?: boolean;

		onCreate?: (
			user: UserAccount,
			config: {
				expires_in: number;
			},
		) => Promise<string>;

		onRefresh?: (refreshToken: string) => Promise<{
			user: UserAccount;
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
}

// ---------------------------------------------------------------------------------------------------------------------

export class RealmDescriptor extends Descriptor<RealmDescriptorOptions> {
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly jwt = $inject(JwtProvider);
	protected readonly log = $logger();

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

		this.securityProvider.createRealm({
			name: this.name,
			profile: this.options.profile,
			secret: "jwks" in this.options ? this.options.jwks : this.options.secret,
			roles,
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

	public async parseToken(token: string): Promise<JWTPayload> {
		const { result } = await this.jwt.parse(token, this.name);
		return result.payload;
	}

	/**
	 * Create a token for the subject.
	 */
	public async createToken(
		user: UserAccount,
		refreshToken?: {
			refresh_token?: string;
			refresh_token_expires_in?: number;
		},
	): Promise<AccessTokenResponse> {
		const refreshTokenEnabled =
			this.options.settings?.refreshToken?.disabled !== false;

		const iat = this.dateTimeProvider.now().unix();
		const exp = iat + this.accessTokenExpiration.asSeconds();

		this.log.trace("Creating access token", {
			sub: user.id,
			exp,
			iat,
			aud: this.name,
		});

		const access_token = await this.jwt.create(
			{
				// jwt
				sub: user.id,
				exp,
				iat,
				aud: this.name,
				// oidc
				name: user.name,
				email: user.email,
				preferred_username: user.username,
				picture: user.picture,
				// our claims
				organizations: user.organizations,
				roles: user.roles,
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
			if (refreshToken) {
				// just copy the refresh token as it is
				response.refresh_token = refreshToken.refresh_token;
				response.refresh_token_expires_in =
					refreshToken.refresh_token_expires_in;
			} else {
				// -----------------------------------------------------------------------------------------------------------------
				// session based

				const create = this.options.settings?.refreshToken?.onCreate;
				if (create) {
					const expires_in = this.refreshTokenExpiration.asSeconds();

					const refresh_token = await create(user, {
						expires_in,
					});

					response.refresh_token = refresh_token;
					response.refresh_token_expires_in = expires_in;
				} else {
					// -----------------------------------------------------------------------------------------------------------------
					// token based

					response.refresh_token_expires_in =
						this.refreshTokenExpiration.asSeconds();

					const payload = {
						sub: user.id,
						exp: iat + this.refreshTokenExpiration.asSeconds(),
						iat,
						aud: this.name,
					};

					this.log.trace("Creating refresh token", payload);

					response.refresh_token = await this.jwt.create(payload, this.name, {
						header: {
							typ: "refresh",
						},
					});
				}
			}
		}

		return response;
	}

	public async refreshToken(
		refreshToken: string,
		accessToken?: string,
	): Promise<{
		tokens: AccessTokenResponse;
		user: UserAccount;
	}> {
		// no refresh -> bye
		if (this.options.settings?.refreshToken?.disabled) {
			throw new SecurityError("Refresh token is disabled for this realm");
		}

		// -----------------------------------------------------------------------------------------------------------------
		// session based

		if (this.options.settings?.refreshToken?.onRefresh) {
			// get user and expiration from the session
			const { user, expires_in } =
				await this.options.settings.refreshToken.onRefresh(refreshToken);

			// then, create a new access token
			const tokens = await this.createToken(user, {
				refresh_token: refreshToken,
				refresh_token_expires_in: expires_in,
			});

			return { user, tokens };
		}

		// -----------------------------------------------------------------------------------------------------------------
		// token based

		if (!accessToken) {
			throw new AlephaError("An access token is required for refreshing");
		}

		// extract user from an expired token
		const user = await this.securityProvider.createUserFromToken(accessToken, {
			realm: this.name,
			verify: {
				currentDate: new Date(0), // don't verify expiration, it's expected to be expired...
			},
		});

		// check if the refresh token is valid + match access token user
		const {
			result: { payload },
		} = await this.jwt.parse(refreshToken, this.name, {
			typ: "refresh",
			audience: this.name,
			subject: user.id,
		});

		const iat = this.dateTimeProvider.now().unix();
		const expires_in = payload.exp
			? payload.exp - iat
			: this.refreshTokenExpiration.asSeconds();

		return {
			user,
			tokens: await this.createToken(user, {
				refresh_token: refreshToken,
				refresh_token_expires_in: expires_in,
			}),
		};
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
