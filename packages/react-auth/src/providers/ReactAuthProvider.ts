import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import { $route, BadRequestError } from "@alepha/server";
import {
	$cookie,
	type Cookies,
	ServerCookiesProvider,
} from "@alepha/server-cookies";
import {
	type Configuration,
	allowInsecureRequests,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	buildEndSessionUrl,
	calculatePKCECodeChallenge,
	discovery,
	randomPKCECodeVerifier,
	refreshTokenGrant,
} from "openid-client";
import { $auth } from "../descriptors/$auth.ts";

export class ReactAuthProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);
	protected authProviders: AuthProvider[] = [];

	protected readonly authorizationCode = $cookie({
		name: "authorizationCode",
		ttl: { minutes: 15 },
		httpOnly: true,
		schema: t.object({
			codeVerifier: t.optional(t.string({ size: "long" })),
			redirectUri: t.optional(t.string({ size: "long" })),
		}),
	});

	protected readonly tokens = $cookie({
		name: "tokens",
		ttl: { days: 1 },
		httpOnly: true,
		compress: true,
		schema: t.object({
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
		ttl: { days: 1 },
		schema: t.object({
			id: t.string(),
			name: t.optional(t.string()),
			email: t.optional(t.string()),
		}),
	});

	public readonly onRender = $hook({
		name: "react:server:render",
		handler: async ({ request, pageRequest }) => {
			pageRequest.user = request.user;
		},
	});

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const auths = this.alepha.getDescriptorValues($auth);
			for (const { value, key, instance } of auths) {
				const options = value.options;

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

					if (this.alepha.isProduction() && !this.alepha.isServerless()) {
						await client.get(); // preload discovery on production, if not serverless
					}

					instance[key].jwks = () => {
						//return client.serverMetadata().jwks_uri;
					};

					this.authProviders.push({
						name: options.name ?? key,
						redirectUri: options.oidc.redirectUri ?? "/api/_oauth/callback",
						client,
					});
				}
			}
		},
	});

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
					request.headers.authorization = `Bearer ${tokens.access_token}`;
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

	/**
	 *
	 */
	public readonly login = $route({
		security: false,
		internal: true,
		path: "/_oauth/login",
		group: "auth",
		method: "GET",
		schema: {
			query: t.object({
				redirect: t.optional(t.string()),
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

	/**
	 *
	 */
	public readonly callback = $route({
		security: false,
		internal: true,
		path: "/_oauth/callback",
		group: "auth",
		method: "GET",
		schema: {
			query: t.object({
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ url, cookies, query, reply }) => {
			const { client } = await this.provider(query.provider);

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
			});

			const user = this.userFromAccessToken(tokens.access_token);
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
				// organization
				// ...
			};
		} catch (e) {
			this.log.warn(e, "Failed to decode access token");
		}
	}

	/**
	 *
	 */
	public readonly logout = $route({
		security: false,
		internal: true,
		path: "/_oauth/logout",
		group: "auth",
		method: "GET",
		schema: {
			query: t.object({
				redirect: t.optional(t.string()),
				provider: t.optional(t.string()),
			}),
		},
		handler: async ({ query, cookies, reply }) => {
			const { client } = await this.provider(query.provider);
			const tokens = this.tokens.get(cookies);
			const idToken = tokens?.id_token;

			const redirect = query.redirect ?? "/";
			const params = new URLSearchParams();

			params.set("post_logout_redirect_uri", redirect);
			if (idToken) {
				params.set("id_token_hint", idToken);
			}

			this.tokens.del(cookies);
			this.user.del(cookies);

			reply.redirect(buildEndSessionUrl(client, params).toString());

			reply.headers.location = buildEndSessionUrl(client, params).toString();
			reply.status = 302;
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
}

export interface AuthProvider {
	name: string;
	redirectUri: string;
	client: {
		get: () => Promise<Configuration>;
	};
}

export interface ReactUser {
	id: string;
	name?: string;
	email?: string;
}
