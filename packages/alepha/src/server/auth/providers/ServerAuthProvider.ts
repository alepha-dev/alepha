import { $hook, $inject, Alepha, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  InvalidCredentialsError,
  type IssuerPrimitive,
  SecurityError,
  type UserAccount,
} from "alepha/security";
import {
  $route,
  BadRequestError,
  type ServerRawRequest,
  type ServerReply,
} from "alepha/server";
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
import { $auth, type AuthPrimitive } from "../primitives/$auth.ts";
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

  /**
   * Validates that a redirect URI is a safe relative path, or — when
   * COOKIE_PARENT_DOMAIN is configured — an https URL whose host is the
   * parent domain or a subdomain of it. Used by SaaS deployments where the
   * OAuth callback dispatches users back to their tenant subdomain.
   *
   * Prevents open redirect attacks by rejecting any other absolute URL.
   */
  protected validateRedirectUri(uri: string): string {
    if (uri.startsWith("/") && !uri.startsWith("//")) {
      return uri;
    }
    const parent = this.alepha.env.COOKIE_PARENT_DOMAIN;
    if (typeof parent === "string" && parent) {
      try {
        const parsed = new URL(uri);
        const parentHost = parent.startsWith(".") ? parent.slice(1) : parent;
        if (parsed.protocol !== "https:") return "/";
        if (parsed.host === parentHost) return uri;
        if (parsed.host.endsWith(`.${parentHost}`)) return uri;
      } catch {
        // fall through
      }
    }
    return "/";
  }

  public get identities(): Array<AuthPrimitive> {
    return this.alepha
      .primitives($auth)
      .filter((auth) => !auth.options.disabled);
  }

  protected readonly authorizationCode = $cookie({
    name: "authorizationCode",
    ttl: [15, "minutes"],
    httpOnly: true,
    encrypt: true,
    schema: t.object({
      provider: t.text(),
      realm: t.optional(t.text()),
      codeVerifier: t.optional(t.text({ size: "long" })),
      redirectUri: t.optional(t.text({ size: "long" })),
      loginUri: t.optional(t.text({ size: "long" })),
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

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      for (const identity of this.identities) {
        await identity.prepare();
      }
    },
  });

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
          request.headers.authorization = `Bearer ${this.extractAccessToken(tokens)}`;
          this.log.trace("Access token set in request headers", {
            provider: tokens.provider,
          });
        }
      }

      // [feature] support for auth providers with fallback
      if (!request.headers.authorization) {
        for (const provider of this.identities) {
          if ("fallback" in provider.options && provider.options.fallback) {
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

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Get user information.
   */
  public readonly userinfo = $route({
    path: alephaServerAuthRoutes.userinfo,
    use: [],
    schema: {
      response: userinfoResponseSchema,
    },
    handler: async ({ user, headers, cookies }) => {
      // Prefer the REQUEST's resolved user (the currentUserAtom): global
      // `server:onRequest` hooks may have rewritten it — e.g. per-org role
      // resolution on a multi-tenant relying party. Re-deriving from the raw
      // tokens here would silently drop those roles, so the token path is
      // only a FALLBACK for sessions whose resolvers don't populate the atom
      // (plain external OAuth2/OIDC providers without an internal issuer).
      let resolved = user;
      if (!resolved) {
        const tokens = this.getTokens(cookies);
        if (tokens) {
          const provider = this.provider(tokens);
          if (!("issuer" in provider.options)) {
            resolved = await provider.user(tokens);
          }
        }
      }

      const api = await this.serverLinksProvider.getUserApiLinks({
        authorization: headers.authorization,
        user: resolved,
      });

      return {
        api,
        user: resolved,
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
        realm: t.optional(
          t.text({ description: "Realm name for multi-realm setups" }),
        ),
      }),
      body: t.object({
        username: t.text(),
        password: t.text(),
      }),
      response: tokenResponseSchema,
    },
    handler: async ({ query, body, cookies }) => {
      const provider = this.provider({
        provider: query.provider,
        realm: query.realm,
      });

      const issuer = provider.issuer;
      if (!issuer) {
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
        ...(await issuer.createToken(user)),
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
        realm: t.optional(
          t.text({ description: "Realm name for multi-realm setups" }),
        ),
        redirect_uri: t.optional(t.text({ size: "rich" })),
      }),
    },
    handler: async ({ query, url, reply, headers }) => {
      const loginUri = headers.referer
        ? new URL(headers.referer).pathname + new URL(headers.referer).search
        : undefined;

      const provider = this.provider({
        provider: query.provider,
        realm: query.realm,
      });
      const oauth = await provider.getOAuth();
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

        // biome-ignore lint/complexity/useOptionalChain: oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
        if (oidc && oidc.responseMode) {
          parameters.response_mode = oidc.responseMode;
        }

        // biome-ignore lint/complexity/useOptionalChain: oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
        if (oidc && oidc.authorizationParameters) {
          Object.assign(parameters, oidc.authorizationParameters);
        }

        this.authorizationCode.set({
          state,
          nonce: parameters.nonce,
          redirectUri: this.validateRedirectUri(query.redirect_uri ?? "/"),
          loginUri,
          provider: query.provider,
          realm: query.realm,
        });

        reply.redirect(
          buildAuthorizationUrl(oauth, parameters).toString(),
          302,
        );
        return;
      }

      // Security note: No state or nonce in the PKCE path is intentional.
      // PKCE provides equivalent CSRF protection to state: the code_verifier is bound
      // to the session cookie, and the authorization code is bound to the code_challenge.
      // An attacker cannot forge the callback without the code_verifier. OAuth 2.1 (RFC 9126)
      // makes PKCE mandatory and state optional. For OIDC nonce: the id_token is received
      // over back-channel TLS from the token endpoint, making nonce replay irrelevant.
      // openid-client/oauth4webapi correctly validates that no state is in the response
      // when none was sent (expectNoState).
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

      // biome-ignore lint/complexity/useOptionalChain: oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
      if (oidc && oidc.responseMode) {
        parameters.response_mode = oidc.responseMode;
      }

      // biome-ignore lint/complexity/useOptionalChain: oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
      if (oidc && oidc.authorizationParameters) {
        Object.assign(parameters, oidc.authorizationParameters);
      }

      this.authorizationCode.set({
        codeVerifier,
        redirectUri: this.validateRedirectUri(query.redirect_uri ?? "/"),
        loginUri,
        provider: query.provider,
        realm: query.realm,
      });

      reply.redirect(buildAuthorizationUrl(oauth, parameters).toString(), 302);
    },
  });

  /**
   * Extracts provider-specific extra profile fields delivered via the
   * authorization callback form body rather than the ID token or userinfo
   * endpoint. Currently handles Apple Sign In's `user` field, which is sent
   * only on the user's first authorization and contains their name.
   */
  protected async extractFormPostProfile(
    req: Request,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const form = await req.formData();
      const userField = form.get("user");
      if (typeof userField !== "string") {
        return undefined;
      }
      const parsed = JSON.parse(userField) as {
        name?: { firstName?: string; lastName?: string };
        email?: string;
      };
      const profile: Record<string, unknown> = {};
      if (parsed.name?.firstName) {
        profile.given_name = parsed.name.firstName;
      }
      if (parsed.name?.lastName) {
        profile.family_name = parsed.name.lastName;
      }
      if (parsed.name?.firstName || parsed.name?.lastName) {
        profile.name = [parsed.name?.firstName, parsed.name?.lastName]
          .filter(Boolean)
          .join(" ");
      }
      if (parsed.email) {
        profile.email = parsed.email;
      }
      return Object.keys(profile).length > 0 ? profile : undefined;
    } catch (e) {
      this.log.warn("Failed to parse form_post profile from callback body", e);
      return undefined;
    }
  }

  /**
   * Shared callback logic for both GET and POST OAuth2/OIDC callbacks.
   * For form_post response mode (e.g. Apple Sign In), the raw Request object
   * is passed so openid-client can read the authorization code from the POST body.
   */
  protected async handleCallback(
    url: URL,
    reply: ServerReply,
    cookies: Cookies,
    raw?: ServerRawRequest,
  ) {
    const authorizationCode = this.authorizationCode.get({ cookies });
    if (!authorizationCode) {
      throw new BadRequestError("Missing code verifier");
    }

    const provider = this.provider(authorizationCode);
    const oauth = await provider.getOAuth();
    if (!oauth) {
      throw new SecurityError(
        `Auth provider '${provider.name}' does not support OAuth2`,
      );
    }

    const redirectUri = authorizationCode.redirectUri ?? "/";
    const loginUri = authorizationCode.loginUri;

    // For form_post response mode (e.g. Apple), pass the raw Request object
    // so openid-client can read the authorization code from the POST body.
    // Clone first so we can also extract provider-specific fields (e.g. Apple's
    // `user` form field, only sent once on first authorization) without
    // consuming the body that openid-client needs to read.
    let currentUrl: URL | Request = url;
    let externalProfile: Record<string, unknown> | undefined;
    if (raw?.web?.req && raw.web.req.method === "POST") {
      const cloned = raw.web.req.clone();
      currentUrl = raw.web.req;
      externalProfile = await this.extractFormPostProfile(cloned);
    }

    const externalTokens = await authorizationCodeGrant(oauth, currentUrl, {
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

    const issuer = provider.issuer;

    // external, full OIDC System (e.g. Keycloak, Auth0)
    if (!issuer) {
      this.setTokens(externalTokens, cookies);
      reply.redirect(redirectUri, 302);
      return;
    }

    // internal, we need to create our own tokens

    let user: UserAccount;
    try {
      user = await provider.user(externalTokens, externalProfile);
    } catch (e) {
      this.log.warn("OAuth2 account linking failed", e);
      const errorTarget = loginUri || redirectUri;
      const errorUrl = new URL(errorTarget, url.origin);
      errorUrl.searchParams.set(
        "error",
        e instanceof BadRequestError ? e.message : "Authentication failed",
      );
      reply.redirect(errorUrl.pathname + errorUrl.search, 302);
      return;
    }

    await this.establishSession(user, issuer, provider.name, cookies);

    reply.redirect(redirectUri, 302);
  }

  /**
   * Establish a local session for an already-resolved user: mint realm tokens
   * and write the `tokens` cookie. Used by the OAuth callback and by federated
   * (broker) login. `issuer` is the realm issuer (provider.issuer / realm).
   */
  public async establishSession(
    user: UserAccount,
    issuer: IssuerPrimitive,
    providerName: string,
    cookies: Cookies,
  ): Promise<void> {
    const tokens = await issuer.createToken(user);
    this.setTokens(
      {
        ...tokens,
        issued_at: this.dateTimeProvider.now().unix(),
        provider: providerName,
      },
      cookies,
    );
  }

  /**
   * Callback for OAuth2/OIDC providers.
   * It handles the authorization code flow and retrieves the access token.
   */
  public readonly callback = $route({
    path: alephaServerAuthRoutes.callback,
    handler: async ({ url, reply, cookies }) => {
      await this.handleCallback(url, reply, cookies);
    },
  });

  /**
   * POST callback for OAuth2/OIDC providers using form_post response mode.
   * Apple Sign In sends the authorization code via POST body instead of URL query parameters.
   */
  public readonly callbackPost = $route({
    path: alephaServerAuthRoutes.callback,
    method: "POST",
    handler: async ({ url, reply, cookies, raw }) => {
      await this.handleCallback(url, reply, cookies, raw);
    },
  });

  /**
   * Logout route for OAuth2/OIDC providers.
   */
  public readonly logout = $route({
    path: alephaServerAuthRoutes.logout,
    method: "POST",
    schema: {
      query: t.object({
        post_logout_redirect_uri: t.optional(t.text()),
      }),
    },
    handler: async ({ query, reply, cookies }) => {
      const redirect = this.validateRedirectUri(
        query.post_logout_redirect_uri ?? "/",
      );
      const tokens = this.getTokens(cookies);
      if (!tokens) {
        reply.redirect(redirect, 302);
        return;
      }

      const provider = this.provider(tokens.provider);

      this.tokens.del({ cookies });

      // for internal providers, we can delete the session - if available
      if (provider.issuer && tokens.refresh_token) {
        const onDeleteSession =
          provider.issuer.options.settings?.onDeleteSession;
        if (onDeleteSession) {
          try {
            await onDeleteSession(tokens.refresh_token);
          } catch (e) {
            this.log.error("Failed to delete session", e);
          }
        }
      }

      const oauth = await provider.getOAuth();
      if (!oauth) {
        reply.redirect(redirect, 302);
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
        reply.redirect(`${customLogoutUri}?${params}`, 302);
        return;
      }

      if (!oauth.serverMetadata().end_session_endpoint) {
        // await tokenRevocation(
        // 	oauth,
        // 	tokens?.refresh_token ?? tokens.access_token,
        // );
        reply.redirect(redirect, 302);
        return;
      }

      reply.redirect(buildEndSessionUrl(oauth, params).toString(), 302);
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  public getAuthenticationProviders(
    filters: { realmName?: string } = {},
  ): AuthenticationProvider[] {
    const providers: AuthenticationProvider[] = [];

    for (const identity of this.identities) {
      if (filters.realmName) {
        const issuer = identity.issuer;
        if (!issuer || issuer.name !== filters.realmName) {
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

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Find an auth provider by name and optionally by realm.
   * When realm is specified, it filters providers by both name and realm.
   * This enables multi-realm setups where multiple providers share the same name (e.g., "credentials").
   */
  protected provider(
    opts: string | { provider: string; realm?: string },
  ): AuthPrimitive {
    const name = typeof opts === "string" ? opts : opts.provider;
    const realmName = typeof opts === "string" ? undefined : opts.realm;

    const identity = this.identities.find((identity) => {
      if (identity.name !== name) {
        return false;
      }

      // If realm filter is specified, match against provider's issuer
      if (realmName && identity.issuer?.name !== realmName) {
        return false;
      }

      return true;
    });

    if (!identity) {
      const realmInfo = realmName ? ` for realm '${realmName}'` : "";
      throw new SecurityError(`Auth provider '${name}'${realmInfo} not found`);
    }

    return identity;
  }

  /**
   * Convert cookies to tokens.
   * If the tokens are expired, try to refresh them using the refresh token.
   */
  protected async cookiesToTokens(
    cookies: Cookies,
  ): Promise<Tokens | undefined> {
    const tokens = this.getTokens(cookies);
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

    // Non-constant-time comparison is fine here — this determines whether to update
    // the cookie, not whether to grant access. No authentication decision is made.
    if (refreshedTokens.access_token !== tokens.access_token) {
      this.setTokens(refreshedTokens, cookies);
    }

    return refreshedTokens;
  }

  protected getTokens(cookies?: Cookies): Tokens | undefined {
    return this.tokens.get({ cookies });
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

  protected extractAccessToken(tokens: Tokens) {
    const idp = this.provider(tokens.provider);

    if (
      "oidc" in idp.options &&
      !("issuer" in idp.options) &&
      idp.options.oidc?.useIdToken
    ) {
      return tokens.id_token;
    }

    return tokens.access_token;
  }

  protected async refreshTokens(tokens: Tokens): Promise<Tokens | undefined> {
    // Note: concurrent requests refreshing with the same token is safe here because
    // Alepha does not rotate refresh tokens — the same token is reused across refreshes
    // (session-based: same UUID in the session row; token-based: same JWT).
    // If single-use rotation is ever added (e.g., for SPA/public clients per OAuth 2.1),
    // a reuse grace window (à la Auth0) should be implemented to avoid race conditions.

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
}

// ---------------------------------------------------------------------------------------------------------------------

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
