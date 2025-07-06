import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type Async,
	OPTIONS,
	t,
} from "@alepha/core";
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
	refreshTokenGrant,
	tokenRevocation,
} from "openid-client";
import { $auth, type AccessToken } from "../descriptors/$auth.ts";
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
		}),
	});

	protected readonly tokens = $cookie({
		name: "tokens",
		ttl: [1, "days"],
		httpOnly: true,
		compress: true,
		schema: t.object({
			provider: t.optional(t.string()),
			access_token: t.optional(t.string({ size: "rich" })),
			expires_in: t.optional(t.number()),
			refresh_token: t.optional(t.string({ size: "rich" })),
			id_token: t.optional(t.string({ size: "rich" })),
			scope: t.optional(t.string()),
			issued_at: t.optional(t.number()),
		}),
	});

	public readonly user = $cookie({
		name: "user",
		ttl: [1, "days"],
		schema: t.object({
			id: t.string(),
			name: t.optional(t.string()),
			email: t.optional(t.string()),
			picture: t.optional(t.string()),
		}),
	});

	public readonly onRender = $hook({
		name: "react:server:render:begin",
		handler: async ({ request, context }) => {
			context.user = request?.user;
		},
	});

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const auths = this.alepha.getDescriptorValues($auth);
			for (const { value, key, instance } of auths) {
				const options = value[OPTIONS];

				if (options.oidc) {
					this.log.debug(
						`Discover OIDC auth provider -> ${options.oidc.issuer}`,
					);

					const oidc = options.oidc;

					const client: {
						cache?: Configuration;
						get: () => Promise<Configuration>;
					} = {
						cache: undefined,
						async get() {
							this.cache ??= await discovery(
								new URL(oidc.issuer),
								oidc.clientId,
								{
									client_secret: oidc.clientSecret,
								},
								undefined,
								{
									execute: [allowInsecureRequests],
								},
							);

							return this.cache as Configuration;
						},
					};

					// TODO: remove cache
					const config = await client.get();

					instance[key].jwks = () => {
						const jwksUri = config.serverMetadata().jwks_uri;
						if (!jwksUri) {
							throw new BadRequestError(
								"JWKS URI is not available in OIDC configuration",
							);
						}
						return jwksUri;
					};

					this.authProviders.push({
						name: options.name ?? key,
						redirectUri: options.oidc.redirectUri ?? ReactAuth.path.callback,
						client,
						fallback: options.fallback,
						useIdToken: options.oidc.useIdToken,
						logoutUri: options.oidc.logoutUri,
					});
				}
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
		name: "server:onRequest",
		after: this.serverCookiesProvider,
		handler: async ({ request }) => {
			if (
				request.cookies &&
				!this.isViteFile(request.url.pathname) &&
				!!this.authProviders.length
			) {
				const tokens = await this.refresh(request.cookies);
				if (tokens) {
					request.headers.authorization = `Bearer ${await this.getAccessTokenFromCookies(tokens)}`;
				}

				if (
					this.user.get(request.cookies) &&
					!this.tokens.get(request.cookies)
				) {
					this.user.del(request.cookies);
				}

				const user = this.user.get(request.cookies);
				if (user) {
					request.user = user;
					request.user.roles = []; // user from cookie is not trusted
				}
			}

			if (!request.headers.authorization) {
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
		const tokens = this.tokens.get(cookies);
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
							provider.client,
							tokens.refresh_token,
						);

						this.tokens.set(cookies, {
							...newTokens,
							issued_at: Date.now(),
						});

						return newTokens;
					} catch (e) {
						if (e instanceof Error) {
							this.log.warn("Failed to refresh token", e.message);
						}
					}
				}

				// session expired and no (valid) refresh token
				this.tokens.del(cookies);
				this.user.del(cookies);
				return;
			}
		}

		if (!tokens.issued_at && tokens.access_token) {
			this.tokens.del(cookies);
			this.user.del(cookies);
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
		handler: async ({ query, cookies, url, reply }) => {
			const { client, redirectUri } = await this.provider(query.provider);

			const codeVerifier = randomPKCECodeVerifier();
			const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
			const scope = "openid profile email";

			let redirect_uri = redirectUri;
			if (redirect_uri.startsWith("/")) {
				redirect_uri = `${url.protocol}//${url.host}${redirect_uri}`;
			}

			const parameters: Record<string, string> = {
				redirect_uri,
				scope,
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
			};

			this.authorizationCode.set(cookies, {
				codeVerifier,
				redirectUri: query.redirect ?? "/",
			});

			reply.redirect(buildAuthorizationUrl(client, parameters).toString());
		},
	});

	public readonly callback = $route({
		path: ReactAuth.path.callback,
		schema: {
			query: t.object({
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ url, cookies, query, reply }) => {
			const { client, name } = await this.provider(query.provider);

			const authorizationCode = this.authorizationCode.get(cookies);
			if (!authorizationCode) {
				throw new BadRequestError("Missing code verifier");
			}

			const tokens = await authorizationCodeGrant(client, url, {
				pkceCodeVerifier: authorizationCode.codeVerifier,
			});

			this.authorizationCode.del(cookies);

			this.tokens.set(cookies, {
				...tokens,
				issued_at: Date.now(),
				provider: name,
			});

			const user = this.userFromAccessToken(
				tokens.id_token ?? tokens.access_token,
			);

			if (user) {
				this.user.set(cookies, user);
			}

			reply.redirect(authorizationCode.redirectUri ?? "/");
		},
	});

	/**
	 *
	 * @param accessToken
	 * @protected
	 */
	protected userFromAccessToken(accessToken: string) {
		try {
			const parts = accessToken.split(".");
			if (parts.length !== 3) {
				return;
			}

			const payload = parts[1];
			const decoded = JSON.parse(atob(payload));
			if (!decoded.sub) {
				return;
			}

			return {
				id: decoded.sub,
				name: decoded.name,
				email: decoded.email,
				picture: decoded.picture,
				// organization
				// ...
			};
		} catch (e) {
			this.log.warn(e, "Failed to decode access token");
		}
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
		handler: async ({ query, cookies, reply }) => {
			const redirect = query.redirect ?? "/";
			const { client, logoutUri } = await this.provider(query.provider);
			const tokens = this.tokens.get(cookies);
			if (!tokens?.access_token) {
				reply.redirect(redirect);
				return;
			}

			const idToken = tokens?.id_token;

			this.tokens.del(cookies);
			this.user.del(cookies);

			if (!client.serverMetadata().end_session_endpoint) {
				await tokenRevocation(
					client,
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

			reply.redirect(buildEndSessionUrl(client, params).toString());
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
			return {
				...authProvider,
				client: await authProvider.client.get(),
			};
		}

		const authProvider = this.authProviders.find(
			(provider) => provider.name === name,
		);

		if (!authProvider) {
			throw new BadRequestError(`Client ${name} not found`);
		}

		await authProvider.client.get();

		return {
			...authProvider,
			client: await authProvider.client.get(),
		};
	}

	/**
	 *
	 * @param file
	 * @protected
	 */
	protected isViteFile(file: string) {
		const [pathname] = file.split("?");

		// swagger
		if (pathname.startsWith("/docs")) {
			return false;
		}

		// static assets
		if (pathname.match(/\.\w{2,5}$/)) {
			return true;
		}

		// vite internal files
		if (pathname.startsWith("/@")) {
			return true;
		}

		// our backend files
		return false;
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
	client: {
		get: () => Promise<Configuration>;
	};
	fallback?: () => Async<AccessToken>;
	useIdToken?: boolean;
	logoutUri?: string;
}

export interface ReactUser {
	id: string;
	name?: string;
	email?: string;
}
