import { $hook, $inject, Alepha, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  InvalidCredentialsError,
  SecurityError,
  type UserAccount,
} from "alepha/security";
import { $route, BadRequestError } from "alepha/server";
import {
  $cookie,
  type Cookies,
  ServerCookiesProvider,
} from "alepha/server/cookies";
import { ServerLinksProvider } from "alepha/server/links";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client";
import { alephaServerAuthRoutes } from "../constants/routes.ts";
import { $auth, type AuthDescriptor } from "../descriptors/$auth.ts";
import type { AuthenticationProvider } from "../schemas/authenticationProviderSchema.ts";
import { tokenResponseSchema } from "../schemas/tokenResponseSchema.ts";
import { type Tokens, tokensSchema } from "../schemas/tokensSchema.ts";
import { userinfoResponseSchema } from "../schemas/userinfoResponseSchema.ts";

export class ServerAuthProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly serverLinksProvider = $inject(ServerLinksProvider);

  protected readonly authorizationCode = $cookie({
    name: "authorizationCode",
    ttl: [15, "minutes"],
    httpOnly: true,
    schema: t.object({
      provider: t.text(),
      codeVerifier: t.optional(t.text({ size: "long" })),
      redirectUri: t.optional(t.text({ size: "long" })),
      state: t.optional(t.text()),
      nonce: t.optional(t.text()),
    }),
  });

  public readonly tokens = $cookie({
    name: "tokens",
    ttl: [30, "days"],
    httpOnly: true,
    compress: true,
    encrypt: true,
    schema: tokensSchema,
  });

  public get identities(): Array<AuthDescriptor> {
    return this.alepha
      .descriptors($auth)
      .filter((auth) => !auth.options.disabled);
  }

  public getAuthenticationProviders(
    filters: { realmName?: string } = {},
  ): AuthenticationProvider[] {
    const providers: AuthenticationProvider[] = [];

    for (const identity of this.identities) {
      if (filters.realmName) {
        const realm = "realm" in identity.options && identity.options.realm;
        if (!realm || realm.name !== filters.realmName) {
          continue;
        }
      }

      const type =
        "oidc" in identity.options
          ? "OIDC"
          : "oauth" in identity.options
            ? "OAUTH2"
            : "credentials" in identity.options
              ? "CREDENTIALS"
              : undefined;

      if (!type) {
        continue;
      }

      providers.push({
        name: identity.name,
        type,
      });
    }

    return providers;
  }

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      for (const identity of this.identities) {
        await identity.prepare();
      }
    },
  });

  protected getAccessTokens(tokens: Tokens) {
    const idp = this.provider(tokens.provider);

    if (
      "oidc" in idp.options &&
      !("realm" in idp.options) &&
      idp.options.oidc?.useIdToken
    ) {
      return tokens.id_token;
    }

    return tokens.access_token;
  }

  /**
   * Fill request headers with access token from cookies or fallback to provider's fallback function.
   */
  protected readonly onRequest = $hook({
    on: "server:onRequest",
    after: this.serverCookiesProvider,
    handler: async ({ request }) => {
      const cookies = request.cookies;

      // [feature] forward cookies to request headers
      if (cookies) {
        const tokens = await this.cookiesToTokens(cookies);
        if (tokens) {
          request.headers.authorization = `Bearer ${this.getAccessTokens(tokens)}`;
          this.log.trace("Access token set in request headers", {
            provider: tokens.provider,
          });
        }
      }

      // [feature] support for auth providers with fallback
      if (!request.headers.authorization) {
        for (const provider of this.identities) {
          if (!("realm" in provider.options) && !!provider.options.fallback) {
            const token = await provider.options.fallback();
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
   * Convert cookies to tokens.
   * If the tokens are expired, try to refresh them using the refresh token.
   */
  protected async cookiesToTokens(
    cookies: Cookies,
  ): Promise<Tokens | undefined> {
    const tokens = this.tokens.get({ cookies });
    if (!tokens) {
      // no cookie, no tokens
      this.log.trace("No tokens found in cookies");
      return;
    }

    this.log.trace("Tokens found in cookies", {
      expires_in: tokens.expires_in,
      issued_at: tokens.issued_at,
    });

    // check if tokens are expired
    const refreshedTokens = await this.refreshTokens(tokens);
    if (!refreshedTokens) {
      this.tokens.del({ cookies });
      // 08/25: exception here will go to Server error handler, not the React one
      // better to remove cookie & session and let the page handle 401 Unauthorized
      //throw new SessionExpiredError("Session expired. Please login again.");
      return;
    }

    if (refreshedTokens.access_token !== tokens.access_token) {
      this.setTokens(refreshedTokens, cookies);
    }

    return refreshedTokens;
  }

  protected async refreshTokens(tokens: Tokens): Promise<Tokens | undefined> {
    if (tokens.expires_in && tokens.issued_at) {
      const gracePeriodSec = 10;
      const expiresAt = tokens.issued_at + (tokens.expires_in - gracePeriodSec);

      if (expiresAt < this.dateTimeProvider.now().unix()) {
        this.log.trace("Tokens are expired");

        // oh no, it is expired
        if (tokens.refresh_token) {
          this.log.trace("Trying to refresh tokens using refresh token");
          // but has refresh token!
          try {
            const provider = this.provider(tokens);
            const result = await provider.refresh(
              tokens.refresh_token,
              tokens.access_token,
            );
            const newTokens = {
              ...result,
              provider: tokens.provider,
              issued_at: this.dateTimeProvider.now().unix(),
            };

            this.log.debug("Tokens refreshed successfully");

            return newTokens;
          } catch (e) {
            this.log.warn("Failed to refresh token", e);
          }
        }

        // session expired and no (valid) refresh token
        return;
      }
    }

    if (!tokens.issued_at && tokens.access_token) {
      return;
    }

    return tokens;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Get user information.
   */
  public readonly userinfo = $route({
    path: alephaServerAuthRoutes.userinfo,
    schema: {
      response: userinfoResponseSchema,
    },
    handler: async ({ user, headers, cookies }) => {
      const tokens = this.tokens.get({ cookies });
      if (tokens) {
        const provider = this.provider(tokens);
        if (!("realm" in provider.options)) {
          const user = await provider.user(tokens);
          const api = await this.serverLinksProvider.getUserApiLinks({
            authorization: headers.authorization,
            user,
          });
          return {
            api,
            user,
          };
        }
      }

      const api = await this.serverLinksProvider.getUserApiLinks({
        authorization: headers.authorization,
        user,
      });

      return {
        api,
        user,
      };
    },
  });

  /**
   * Refresh a token for internal providers.
   */
  public readonly refresh = $route({
    path: alephaServerAuthRoutes.refresh,
    method: "POST",
    schema: {
      query: t.object({
        provider: t.text(),
      }),
      body: t.object({
        refresh_token: t.text({
          size: "rich",
        }),
        access_token: t.optional(
          t.text({
            size: "rich",
            description:
              "Required if provider has stateless refresh token on credentials mode",
          }),
        ),
      }),
      response: tokensSchema,
    },
    handler: async ({ query, body, cookies }) => {
      const provider = this.provider(query);

      const tokens = {
        provider: query.provider,
        ...(await provider.refresh(body.refresh_token, body.access_token)),
      };

      // for web applications, we store tokens in cookies
      this.setTokens(tokens, cookies);

      return tokens;
    },
  });

  /**
   * Login for local password-based authentication.
   */
  public readonly token = $route({
    path: alephaServerAuthRoutes.token,
    method: "POST",
    schema: {
      query: t.object({
        provider: t.text(),
      }),
      body: t.object({
        username: t.text(),
        password: t.text(),
      }),
      response: tokenResponseSchema,
    },
    handler: async ({ query, body, cookies }) => {
      const provider = this.provider(query);
      const realm = "realm" in provider.options && provider.options.realm;
      if (!realm) {
        throw new SecurityError(
          `Auth provider '${query.provider}' does not support password grant`,
        );
      }

      const credentials =
        "credentials" in provider.options && provider.options.credentials;

      if (!credentials) {
        throw new SecurityError(
          `Auth provider '${query.provider}' does not support password grant`,
        );
      }

      let user: UserAccount | undefined;
      try {
        user = await credentials.account(body);
      } catch (e) {
        if (e instanceof InvalidCredentialsError) {
          throw e;
        }
        this.log.error("Failed to authenticate user", e);
        throw new InvalidCredentialsError();
      }

      if (!user) {
        throw new InvalidCredentialsError();
      }

      const tokens = {
        provider: query.provider,
        ...(await realm.createToken(user)),
      };

      // for web applications, we store tokens in cookies
      this.setTokens(tokens, cookies);

      const api = await this.serverLinksProvider.getUserApiLinks({
        user,
      });

      // mobile apps require this
      return {
        ...tokens,
        user,
        api,
      };
    },
  });

  /**
   * Oauth2/OIDC login route.
   */
  public readonly login = $route({
    path: alephaServerAuthRoutes.login,
    schema: {
      query: t.object({
        provider: t.text(),
        redirect_uri: t.optional(t.text({ size: "rich" })),
      }),
    },
    handler: async ({ query, url, reply }) => {
      const provider = this.provider(query);
      const oauth = provider.oauth;
      if (!oauth) {
        throw new SecurityError(
          `Auth provider '${query.provider}' does not support OAuth2`,
        );
      }

      const scope = provider.scope;
      let redirect_uri =
        provider.redirect_uri || alephaServerAuthRoutes.callback;
      if (redirect_uri.startsWith("/")) {
        redirect_uri = `${url.protocol}//${url.host}${redirect_uri}`;
      }

      const oidc = "oidc" in provider.options && provider.options.oidc;

      if (!oauth.serverMetadata().supportsPKCE()) {
        const state = randomState();
        const parameters: Record<string, string> = {
          redirect_uri,
          state,
        };

        if (oidc) {
          parameters.nonce = randomState();
        }

        if (scope) {
          parameters.scope = scope;
        }

        this.authorizationCode.set({
          state,
          nonce: parameters.nonce,
          redirectUri: query.redirect_uri ?? "/",
          provider: query.provider,
        });

        reply.redirect(buildAuthorizationUrl(oauth, parameters).toString());
        return;
      }

      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

      const parameters: Record<string, string> = {
        redirect_uri,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      };

      if (scope) {
        parameters.scope = scope;
      }

      this.authorizationCode.set({
        codeVerifier,
        redirectUri: query.redirect_uri ?? "/",
        provider: query.provider,
      });

      reply.redirect(buildAuthorizationUrl(oauth, parameters).toString());
    },
  });

  /**
   * Callback for OAuth2/OIDC providers.
   * It handles the authorization code flow and retrieves the access token.
   */
  public readonly callback = $route({
    path: alephaServerAuthRoutes.callback,
    handler: async ({ url, reply, cookies }) => {
      const authorizationCode = this.authorizationCode.get({ cookies });
      if (!authorizationCode) {
        throw new BadRequestError("Missing code verifier");
      }

      const provider = this.provider(authorizationCode);
      const oauth = provider.oauth;
      if (!oauth) {
        throw new SecurityError(
          `Auth provider '${provider.name}' does not support OAuth2`,
        );
      }

      const redirectUri = authorizationCode.redirectUri ?? "/";

      const externalTokens = await authorizationCodeGrant(oauth, url, {
        pkceCodeVerifier: authorizationCode.codeVerifier,
        expectedState: authorizationCode.state,
        expectedNonce: authorizationCode.nonce,
      })
        .then((tokens) => ({
          issued_at: this.dateTimeProvider.now().unix(),
          provider: provider.name,
          ...tokens,
        }))
        .catch((e) => {
          this.log.error("Failed to get access token", e);
          throw new SecurityError("Failed to get access token", {
            cause: e,
          });
        });

      this.authorizationCode.del({ cookies });

      const realm = "realm" in provider.options && provider.options.realm;

      // external, full OIDC System (e.g. Keycloak, Auth0)
      if (!realm) {
        this.setTokens(externalTokens, cookies);
        reply.redirect(redirectUri);
        return;
      }

      // internal, we need to create our own tokens

      const user = await provider.user(externalTokens);
      const tokens = await realm.createToken(user);

      this.setTokens(
        {
          ...tokens,
          issued_at: this.dateTimeProvider.now().unix(),
          provider: provider.name,
        },
        cookies,
      );

      reply.redirect(redirectUri);
    },
  });

  /**
   * Logout route for OAuth2/OIDC providers.
   */
  public readonly logout = $route({
    path: alephaServerAuthRoutes.logout,
    method: "GET",
    schema: {
      query: t.object({
        post_logout_redirect_uri: t.optional(t.text()),
      }),
    },
    handler: async ({ query, reply, cookies }) => {
      const redirect = query.post_logout_redirect_uri ?? "/";
      const tokens = this.tokens.get({ cookies });
      if (!tokens) {
        reply.redirect(redirect);
        return;
      }

      const provider = this.provider(tokens.provider);

      this.tokens.del({ cookies });

      // for internal providers, we can delete the session - if available
      if ("realm" in provider.options && tokens.refresh_token) {
        const onDeleteSession =
          provider.options.realm.options.settings?.onDeleteSession;
        if (onDeleteSession) {
          try {
            await onDeleteSession(tokens.refresh_token);
          } catch (e) {
            this.log.error("Failed to delete session", e);
          }
        }
      }

      const oauth = provider.oauth;
      if (!oauth) {
        reply.redirect(redirect);
        return;
      }

      const params = new URLSearchParams();
      const idToken = tokens?.id_token;

      params.set("post_logout_redirect_uri", redirect);
      if (idToken) {
        params.set("id_token_hint", idToken);
      }

      const customLogoutUri =
        "oidc" in provider.options
          ? provider.options.oidc?.logoutUri
          : undefined;

      if (customLogoutUri) {
        reply.redirect(`${customLogoutUri}?${params}`);
        return;
      }

      if (!oauth.serverMetadata().end_session_endpoint) {
        // await tokenRevocation(
        // 	oauth,
        // 	tokens?.refresh_token ?? tokens.access_token,
        // );
        reply.redirect(redirect);
        return;
      }

      reply.redirect(buildEndSessionUrl(oauth, params).toString());
    },
  });

  protected provider(opts: string | { provider: string }): AuthDescriptor {
    const name = typeof opts === "string" ? opts : opts.provider;
    const identity = this.identities.find((identity) => identity.name === name);

    if (!identity) {
      throw new SecurityError(`Auth provider '${name}' not found`);
    }

    return identity;
  }

  protected setTokens(tokens: Tokens, cookies?: Cookies): void {
    const exp =
      tokens.refresh_token_expires_in ||
      tokens.refresh_expires_in ||
      tokens.expires_in;

    const ttl = exp
      ? this.dateTimeProvider.duration(exp, "seconds")
      : undefined;

    this.tokens.set(tokens, {
      cookies,
      ttl,
    });
  }
}

export interface OAuth2Profile {
  sub: string; // Subject - unique ID per user (required by OpenID)
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  profile?: string;
  picture?: string;
  website?: string;
  email_verified?: boolean;
  gender?: string;
  birthdate?: string; // ISO 8601: YYYY-MM-DD
  zoneinfo?: string;
  locale?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  address?: {
    formatted?: string;
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  updated_at?: number; // seconds since epoch
  // Allow additional fields (provider-specific)
  [key: string]: unknown;
}
