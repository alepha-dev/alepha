import { $hook, $inject, Alepha, z } from "alepha";
import { DateTimeProvider, type Duration } from "alepha/datetime";
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
  CookieParser,
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
import {
  $auth,
  type AccessToken,
  type AuthPrimitive,
} from "../primitives/$auth.ts";
import type { AuthenticationProvider } from "../schemas/authenticationProviderSchema.ts";
import { tokenResponseSchema } from "../schemas/tokenResponseSchema.ts";
import { type Tokens, tokensSchema } from "../schemas/tokensSchema.ts";
import { userinfoResponseSchema } from "../schemas/userinfoResponseSchema.ts";

export class ServerAuthProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);
  protected readonly cookieParser = $inject(CookieParser);
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
    // Reject backslashes: browsers normalize `/\evil.com` to `//evil.com`,
    // turning a "relative" path into a protocol-relative open redirect.
    if (uri.startsWith("/") && !uri.startsWith("//") && !uri.includes("\\")) {
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
    schema: z.object({
      provider: z.text(),
      realm: z.text().optional(),
      codeVerifier: z.text({ size: "long" }).optional(),
      redirectUri: z.text({ size: "long" }).optional(),
      loginUri: z.text({ size: "long" }).optional(),
      state: z.text().optional(),
      nonce: z.text().optional(),
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
            const token = await this.resolveAccessToken(
              await provider.options.fallback(),
            );
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
      query: z.object({
        provider: z.text(),
      }),
      body: z.object({
        refresh_token: z.text({
          size: "rich",
        }),
        access_token: z
          .text({
            size: "rich",
            description:
              "Required if provider has stateless refresh token on credentials mode",
          })
          .optional(),
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
      query: z.object({
        provider: z.text(),
        realm: z
          .text({ description: "Realm name for multi-realm setups" })
          .optional(),
      }),
      body: z.object({
        username: z.text(),
        password: z.text(),
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
   * Resolve an {@link AccessToken} to the string that goes in the header.
   *
   * The type admits `{ token: () => Async<string> }` — the form the `fallback`
   * JSDoc example uses, passing a `$serviceAccount` — but the value was
   * interpolated directly, so the documented form produced
   * `Bearer [object Object]`.
   */
  protected async resolveAccessToken(
    token: AccessToken | undefined,
  ): Promise<string | undefined> {
    if (!token) {
      return undefined;
    }

    return typeof token === "string" ? token : await token.token();
  }

  /**
   * Path + query of a `Referer`, or `undefined` when it is absent or not a
   * parseable URL.
   */
  protected refererPath(referer?: string): string | undefined {
    if (!referer) {
      return undefined;
    }

    try {
      const url = new URL(referer);
      return url.pathname + url.search;
    } catch {
      return undefined;
    }
  }

  /**
   * Oauth2/OIDC login route.
   */
  public readonly login = $route({
    path: alephaServerAuthRoutes.login,
    schema: {
      query: z.object({
        provider: z.text(),
        realm: z
          .text({ description: "Realm name for multi-realm setups" })
          .optional(),
        redirect_uri: z.text({ size: "rich" }).optional(),
      }),
    },
    handler: async ({ query, url, reply, headers }) => {
      // A Referer is attacker- and browser-controlled and is not guaranteed to
      // be a URL — sandboxed origins legitimately send `null`. Parsing it
      // unguarded turned the whole login into a 500.
      const loginUri = this.refererPath(headers.referer);

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

        // oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
        if (oidc && oidc.responseMode) {
          parameters.response_mode = oidc.responseMode;
        }

        // oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
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

      // oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
      if (oidc && oidc.responseMode) {
        parameters.response_mode = oidc.responseMode;
      }

      // oidc is `false | OidcOptions`; optional chaining doesn't narrow `false`
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
   * Build a web `Request` for a `form_post` callback, on either runtime.
   *
   * Web-request runtimes (workerd, Bun, Deno) hand us one already. The Node
   * adapter does not — it only carries an `IncomingMessage` — and the code
   * used to check `raw.web.req` alone, so on plain Node `currentUrl` stayed the
   * query URL, the authorization code was never read from the body, and Apple
   * Sign In failed outright. The body is a small form post, so it is buffered
   * rather than streamed: no `duplex` handling, no `node:stream` import.
   *
   * Returns `undefined` for anything that is not a POST — a normal
   * query-parameter callback keeps using the URL.
   */
  protected async toWebRequest(
    url: URL,
    raw?: ServerRawRequest,
  ): Promise<Request | undefined> {
    if (raw?.web?.req && raw.web.req.method === "POST") {
      return raw.web.req;
    }

    const nodeReq = raw?.node?.req;
    if (!nodeReq || nodeReq.method !== "POST") {
      return undefined;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    return new Request(url, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
    });
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

    // For form_post response mode (e.g. Apple), pass a web Request so
    // openid-client can read the authorization code from the POST body.
    // Clone first so we can also extract provider-specific fields (e.g. Apple's
    // `user` form field, only sent once on first authorization) without
    // consuming the body that openid-client needs to read.
    let currentUrl: URL | Request = url;
    let externalProfile: Record<string, unknown> | undefined;
    const postRequest = await this.toWebRequest(url, raw);
    if (postRequest) {
      currentUrl = postRequest;
      externalProfile = await this.extractFormPostProfile(postRequest.clone());
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
      query: z.object({
        post_logout_redirect_uri: z.text().optional(),
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
   * Resolve a bearer access token from a raw `Cookie` request header — the WebSocket upgrade
   * path.
   *
   * Browsers cannot attach an `Authorization` header to a WebSocket handshake, so for a web
   * client the encrypted `tokens` cookie is the ONLY auth channel a socket upgrade carries.
   * Ordinary HTTP requests get the cookie→authorization conversion from this provider's
   * `server:onRequest` hook, but an upgrade never runs the server pipeline, so
   * `WebSocketServerProvider.resolveUserId` calls this directly. Refresh side effects (an
   * updated or deleted cookie) cannot reach the client here — there is no HTTP response to
   * carry a `Set-Cookie` — which is acceptable: the next ordinary HTTP request performs the
   * same refresh and persists it.
   */
  public async accessTokenFromCookieHeader(
    cookieHeader: string,
  ): Promise<string | undefined> {
    const cookies: Cookies = {
      req: this.cookieParser.parseRequestCookies(cookieHeader),
      res: {},
    };
    const tokens = await this.cookiesToTokens(cookies);
    if (!tokens) return undefined;
    return this.extractAccessToken(tokens);
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

  /**
   * How long the token cookie should live.
   *
   * The cookie carries the *refresh* token, so its lifetime is the refresh
   * token's — not the access token's. Falling back to `expires_in` truncated
   * the session to the access-token lifetime: Google reports only
   * `expires_in` (3600) alongside a long-lived refresh token, so users were
   * signed out after an hour despite a refresh token that was still good.
   *
   * When no refresh expiry is reported, `undefined` lets the `$cookie`
   * default apply. `expires_in` is only right when there is no refresh token
   * at all — then the session really does end with the access token.
   */
  protected tokenCookieTtl(tokens: Tokens): Duration | undefined {
    const exp =
      tokens.refresh_token_expires_in ||
      tokens.refresh_expires_in ||
      (tokens.refresh_token ? undefined : tokens.expires_in);

    return exp ? this.dateTimeProvider.duration(exp, "seconds") : undefined;
  }

  protected setTokens(tokens: Tokens, cookies?: Cookies): void {
    this.tokens.set(tokens, {
      cookies,
      ttl: this.tokenCookieTtl(tokens),
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
