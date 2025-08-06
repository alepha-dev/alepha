import { $hook, $inject, $logger, Alepha, type Async, t } from "@alepha/core";
import {
	type RealmDescriptor,
	SecurityError,
	type UserAccountInfo,
} from "@alepha/security";
import { $route, BadRequestError } from "@alepha/server";
import {
	$cookie,
	type Cookies,
	ServerCookiesProvider,
} from "@alepha/server-cookies";
import {
	allowInsecureRequests,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	buildEndSessionUrl,
	type Configuration,
	calculatePKCECodeChallenge,
	discovery,
	randomPKCECodeVerifier,
	randomState,
	refreshTokenGrant,
	tokenRevocation,
} from "openid-client";
import {
	$auth,
	type AccessToken,
	type OAuthOptions,
	type OidcOptions,
} from "../descriptors/$auth.ts";
import { type Tokens, tokensSchema } from "../schemas/tokensSchema.ts";
import { userProfileSchema } from "../schemas/userProfileSchema.ts";
import { ReactAuth } from "../services/ReactAuth.ts";

export class ReactAuthProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);
	protected authProviders: AuthProvider[] = [];

	protected readonly authorizationCode = $cookie({
		name: "authorizationCode",
		ttl: [15, "minutes"],
		httpOnly: true,
		schema: t.object({
			codeVerifier: t.optional(t.string({ size: "long" })),
			redirectUri: t.optional(t.string({ size: "long" })),
			state: t.optional(t.string()),
			nonce: t.optional(t.string()),
		}),
	});

	public readonly tokens = $cookie({
		name: "tokens",
		ttl: [1, "days"], // TODO
		httpOnly: true,
		compress: true,
		schema: tokensSchema,
	});

	public readonly user = $cookie({
		name: "user",
		ttl: [1, "day"], // TODO
		schema: userProfileSchema,
	});

	public readonly onRender = $hook({
		on: "react:server:render:begin",
		handler: async ({ request, context }) => {
			context.user = request?.user;
		},
	});

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			const auths = this.alepha.descriptors($auth);
			for (const auth of auths) {
				const options = auth.options;
				if (options.disabled) {
					continue;
				}

				if ("oidc" in options) {
					this.log.debug(
						`Discover OIDC auth provider -> ${options.oidc.issuer}`,
					);

					const oidc = options.oidc;

					const addons: Array<(config: Configuration) => void> = [];
					if (!this.alepha.isProduction()) {
						addons.push(allowInsecureRequests);
					}

					const config = await discovery(
						new URL(oidc.issuer),
						oidc.clientId,
						{
							client_secret: oidc.clientSecret,
						},
						undefined,
						{
							execute: addons,
						},
					);

					auth.jwks = () => {
						const jwksUri = config.serverMetadata().jwks_uri;
						if (!jwksUri) {
							throw new BadRequestError(
								"JWKS URI is not available in OIDC configuration",
							);
						}
						return jwksUri;
					};

					this.authProviders.push({
						name: auth.name,
						redirectUri: options.oidc.redirectUri ?? ReactAuth.path.callback,
						fallback: options.fallback,
						useIdToken: options.oidc.useIdToken,
						logoutUri: options.oidc.logoutUri,
						config,
						oidc: options.oidc,
						scope: options.oidc.scope ?? "openid profile email",
						profile: options.profile,
						realm: options.realm,
						user: options.user,
					});
				}

				// if ("oauth" in options) {
				// 	const oauth = options.oauth;
				//
				// 	const config = new Configuration(
				// 		{
				// 			authorization_endpoint: oauth.authorization,
				// 			token_endpoint: oauth.token,
				// 			issuer: oauth.authorization, // Use authorization URL as a pseudo-issuer
				// 			jwks_uri: undefined,
				// 			end_session_endpoint: undefined, // Pure OAuth2 usually doesn't have this
				// 		},
				// 		oauth.clientId,
				// 		{
				// 			client_secret: oauth.clientSecret,
				// 		},
				// 	);
				//
				// 	this.authProviders.push({
				// 		name: auth.name,
				// 		redirectUri: options.oauth.redirectUri ?? ReactAuth.path.callback,
				// 		fallback: options.fallback,
				// 		config,
				// 		oauth: options.oauth,
				// 		scope: options.oauth.scope,
				// 		profile: options.profile,
				// 	});
				// }
			}
		},
	});

	protected async getAccessTokenFromCookies(tokens: SessionTokens) {
		const { useIdToken } = await this.provider(tokens.provider);
		if (useIdToken && tokens.id_token) {
			return tokens.id_token;
		}
		return tokens.access_token;
	}

	/**
	 * Configure Fastify to forward Session Access Token to Header Authorization.
	 */
	protected readonly onRequest = $hook({
		on: "server:onRequest",
		after: this.serverCookiesProvider,
		handler: async ({ request }) => {
			const cookies = request.cookies;
			if (cookies) {
				const tokens = await this.refresh(cookies);
				if (tokens) {
					request.headers.authorization = `Bearer ${await this.getAccessTokenFromCookies(tokens)}`;
				}

				if (this.user.get({ cookies }) && !this.tokens.get({ cookies })) {
					this.user.del({ cookies });
				}

				const user = this.user.get({ cookies });
				if (user) {
					request.user = user;
					request.user.roles = []; // user from cookie is not trusted
				}
			}

			if (!request.headers.authorization && !!this.authProviders.length) {
				for (const provider of this.authProviders) {
					if (provider.fallback) {
						const token = await provider.fallback();
						if (token) {
							request.headers.authorization = `Bearer ${token}`;
							break;
						}
					}
				}
			}
		},
	});

	/**
	 *
	 * @param cookies
	 * @protected
	 */
	protected async refresh(
		cookies: Cookies,
	): Promise<SessionTokens | undefined> {
		const now = Date.now();
		const tokens = this.tokens.get({ cookies });
		if (!tokens) {
			return;
		}

		if (tokens.expires_in && tokens.issued_at) {
			const expiresAt = tokens.issued_at + (tokens.expires_in - 10) * 1000;
			if (expiresAt < now) {
				// is expired
				if (tokens.refresh_token) {
					// but has refresh token
					try {
						const provider = await this.provider();
						const newTokens = await refreshTokenGrant(
							provider.config,
							tokens.refresh_token,
						);

						this.tokens.set(
							{
								...newTokens,
								issued_at: Date.now(),
							},
							{ cookies },
						);

						return newTokens;
					} catch (e) {
						if (e instanceof Error) {
							this.log.warn("Failed to refresh token", e.message);
						}
					}
				}

				// session expired and no (valid) refresh token
				this.tokens.del({ cookies });
				this.user.del({ cookies });
				return;
			}
		}

		if (!tokens.issued_at && tokens.access_token) {
			this.tokens.del({ cookies });
			this.user.del({ cookies });
			return;
		}

		return tokens;
	}

	public readonly login = $route({
		path: ReactAuth.path.login,
		schema: {
			query: t.object({
				redirect: t.optional(t.string({ size: "rich" })),
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ query, url, reply }) => {
			const {
				config,
				redirectUri,
				scope = "openid profile email",
			} = await this.provider(query.provider);

			let redirect_uri = redirectUri;
			if (redirect_uri.startsWith("/")) {
				redirect_uri = `${url.protocol}//${url.host}${redirect_uri}`;
			}

			if (!config.serverMetadata().supportsPKCE()) {
				const state = randomState();
				const nonce = randomState();
				const parameters: Record<string, string> = {
					redirect_uri,
					scope,
					state,
					nonce,
				};

				this.authorizationCode.set({
					state,
					nonce,
					redirectUri: query.redirect ?? "/",
				});

				reply.redirect(buildAuthorizationUrl(config, parameters).toString());
				return;
			}

			const codeVerifier = randomPKCECodeVerifier();
			const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

			const parameters: Record<string, string> = {
				redirect_uri,
				scope,
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
			};

			this.authorizationCode.set({
				codeVerifier,
				redirectUri: query.redirect ?? "/",
			});

			reply.redirect(buildAuthorizationUrl(config, parameters).toString());
		},
	});

	public readonly callback = $route({
		path: ReactAuth.path.callback,
		schema: {
			query: t.object({
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ url, query, reply }) => {
			const authProvider = await this.provider(query.provider);
			const { config, name } = authProvider;

			const authorizationCode = this.authorizationCode.get();
			if (!authorizationCode) {
				throw new BadRequestError("Missing code verifier");
			}

			const tokens = await authorizationCodeGrant(config, url, {
				pkceCodeVerifier: authorizationCode.codeVerifier,
				expectedState: authorizationCode.state,
				expectedNonce: authorizationCode.nonce,
			}).catch((e) => {
				this.log.error("Failed to get access token", e);
				throw new SecurityError("Failed to get access token", {
					cause: e,
				});
			});

			this.authorizationCode.del();
			const profile = await this.getUserProfile(authProvider, tokens);

			if (authProvider.realm && authProvider.user) {
				const user = await authProvider.user({
					...profile,
					provider: name,
				});

				const access_token = await authProvider.realm.createToken(
					user.id,
					user.roles,
				);

				this.tokens.set({
					access_token,
					issued_at: Date.now(),
					provider: name,
				});

				try {
					this.user.set(user);
				} catch (e) {
					throw new SecurityError("Failed to get user profile", { cause: e });
				}
			} else {
				this.tokens.set({
					...tokens,
					issued_at: Date.now(),
					provider: name,
				});
				try {
					this.user.set(profile);
				} catch (e) {
					throw new SecurityError("Failed to get user profile", { cause: e });
				}
			}

			reply.redirect(authorizationCode.redirectUri ?? "/");
		},
	});

	protected async getUserProfile(
		authProvider: AuthProvider,
		tokens: Tokens,
	): Promise<UserProfile> {
		if (authProvider.oauth?.user) {
			return authProvider.oauth.user(tokens);
		}

		const token = tokens.id_token ?? tokens.access_token;
		if (!token) {
			throw new SecurityError("No access token or ID token found");
		}

		const payload = token.split(".")[1];
		const decoded = JSON.parse(atob(payload));

		if (!decoded.sub) {
			throw new SecurityError("No user ID found in token");
		}

		if (authProvider.profile) {
			return authProvider.profile(decoded);
		}

		// generic jwt to profile mapping

		return {
			id: String(decoded.sub),
			name: decoded.name,
			email: decoded.email,
			picture: decoded.picture,
			// organizations
			// ...
		};
	}

	public readonly logout = $route({
		path: ReactAuth.path.logout,
		method: "GET",
		schema: {
			query: t.object({
				redirect: t.optional(t.string()),
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ query, reply }) => {
			const redirect = query.redirect ?? "/";
			const { config, logoutUri, oauth } = await this.provider(query.provider);
			const tokens = this.tokens.get();
			if (!tokens?.access_token) {
				reply.redirect(redirect);
				return;
			}

			const idToken = tokens?.id_token;

			this.tokens.del();
			this.user.del();

			if (oauth) {
				// for now, we only support logout for OIDC
				reply.redirect(redirect);
				return;
			}

			if (!config.serverMetadata().end_session_endpoint) {
				await tokenRevocation(
					config,
					tokens?.refresh_token ?? tokens.access_token,
				);
				reply.redirect(redirect);
				return;
			}

			const params = new URLSearchParams();

			params.set("post_logout_redirect_uri", redirect);
			if (idToken) {
				params.set("id_token_hint", idToken);
			}

			if (logoutUri) {
				reply.redirect(`${logoutUri}?${params}`);
				return;
			}

			reply.redirect(buildEndSessionUrl(config, params).toString());
		},
	});

	/**
	 *
	 * @param name
	 * @protected
	 */
	protected async provider(name?: string) {
		if (!name) {
			const authProvider = this.authProviders[0];
			if (!authProvider) {
				throw new BadRequestError("Client name is required");
			}
			return authProvider;
		}

		const authProvider = this.authProviders.find(
			(provider) => provider.name === name,
		);

		if (!authProvider) {
			throw new BadRequestError(`Client ${name} not found`);
		}

		return authProvider;
	}
}

export interface SessionTokens {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	id_token?: string;
	scope?: string;
	issued_at?: number;
	provider?: string;
}

export interface AuthProvider {
	name: string;
	redirectUri: string;
	scope?: string;
	fallback?: () => Async<AccessToken>;
	useIdToken?: boolean;
	logoutUri?: string;
	config: Configuration;
	oidc?: OidcOptions;
	oauth?: OAuthOptions;
	profile?: (raw: any) => Async<UserProfile>;

	user?: (
		profile: UserProfile & { provider: string },
	) => Async<UserAccountInfo>;
	realm?: RealmDescriptor;
}

export interface UserProfile {
	id: string;
	name?: string;
	email?: string;
	picture?: string;
}
