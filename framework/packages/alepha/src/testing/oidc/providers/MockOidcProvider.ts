import { createHash } from "node:crypto";

import { $inject, AlephaError, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $route, type ServerReply } from "alepha/server";
import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";

/**
 * An OpenID Connect provider for tests: discovery, authorize, token, JWKS,
 * end-session, revocation and back-channel logout, laid out as Keycloak lays
 * them out (`/realms/<realm>/protocol/openid-connect/...`), so an app points
 * at it with the same configuration it uses for a real Keycloak.
 *
 * It approves every authorization request at once, as the configured user,
 * and checks what a real provider checks on the way: the client, the redirect
 * URI, the PKCE verifier, the refresh token. A spec chooses the claims, the
 * token lifetime and which endpoints discovery advertises through
 * {@link MockOidcProvider.options}, and reads what reached the provider
 * through {@link MockOidcProvider.calls}.
 *
 * It is served by {@link MockOidcServer}, which gives it a real HTTP port:
 * `openid-client` runs discovery and the token exchange over `fetch`.
 */
export class MockOidcProvider {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * What the provider answers with. Mutable: a spec may change a field
   * between two requests, the next one reads it.
   */
  public options: MockOidcResolvedOptions = this.resolveOptions({});

  /**
   * Every request that reached an endpoint, in order.
   */
  public readonly calls: MockOidcCall[] = [];

  /**
   * The origin the provider is served from, set by {@link MockOidcServer}.
   */
  public origin = "";

  protected keys?: { privateKey: CryptoKey; publicJwk: JWK };
  protected readonly codes = new Map<string, MockOidcCode>();
  protected readonly refreshTokens = new Map<string, MockOidcGrant>();
  protected readonly revoked = new Set<string>();

  /**
   * The issuer identifier, exactly as discovery and every token carry it.
   */
  public get issuer(): string {
    return `${this.origin}/realms/${this.options.realm}`;
  }

  /**
   * Replace the options, filling in the defaults.
   */
  public configure(options: MockOidcOptions): void {
    this.options = this.resolveOptions(options);
  }

  /**
   * Whether a refresh token was revoked through the revocation endpoint, or
   * by an end-session request carrying its session.
   */
  public isRevoked(token: string): boolean {
    return this.revoked.has(token);
  }

  /**
   * The session id of every grant still alive, newest last.
   */
  public sessions(): string[] {
    return [...this.refreshTokens.values()]
      .filter((it) => !this.revoked.has(it.refreshToken))
      .map((it) => it.sid);
  }

  /**
   * Sign a logout token (OpenID Connect Back-Channel Logout 1.0) for one
   * client. Pass `sid`, `sub` or both; `claims` adds or overrides members, to
   * build an invalid one.
   */
  public async createLogoutToken(options: {
    clientId?: string;
    sid?: string;
    sub?: string;
    claims?: Record<string, unknown>;
  }): Promise<string> {
    const iat = this.dateTime.now().unix();
    return this.sign({
      iss: this.issuer,
      aud: options.clientId ?? this.options.clients[0]!.clientId,
      iat,
      exp: iat + 120,
      jti: this.crypto.randomUUID(),
      events: {
        "http://schemas.openid.net/event/backchannel-logout": {},
      },
      ...(options.sid ? { sid: options.sid } : {}),
      ...(options.sub ? { sub: options.sub } : {}),
      ...options.claims,
    });
  }

  /**
   * Sign an access token as this provider would, outside any grant: for a
   * spec that presents a bearer token directly.
   */
  public async createAccessToken(
    options: { clientId?: string; claims?: Record<string, unknown> } = {},
  ): Promise<string> {
    const clientId = options.clientId ?? this.options.clients[0]!.clientId;
    return this.sign({
      ...this.accessTokenClaims({
        clientId,
        sid: this.crypto.randomUUID(),
        scope: "openid profile email",
      }),
      ...options.claims,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  public readonly discovery = $route({
    path: "/realms/:realm/.well-known/openid-configuration",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
    },
    handler: ({ params, reply }) => {
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }
      this.record("discovery");

      const base = `${this.issuer}/protocol/openid-connect`;
      const advertise = this.options.advertise;
      return {
        issuer: this.issuer,
        authorization_endpoint: `${base}/auth`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/certs`,
        ...(advertise.endSession
          ? { end_session_endpoint: `${base}/logout` }
          : {}),
        ...(advertise.revocation
          ? { revocation_endpoint: `${base}/revoke` }
          : {}),
        ...(advertise.backchannelLogout
          ? {
              backchannel_logout_supported: true,
              backchannel_logout_session_supported: true,
            }
          : {}),
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none",
        ],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "profile", "email"],
      };
    },
  });

  public readonly jwks = $route({
    path: "/realms/:realm/protocol/openid-connect/certs",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params, reply }) => {
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }
      this.record("jwks");
      const { publicJwk } = await this.getKeys();
      return { keys: [publicJwk] };
    },
  });

  /**
   * Approves at once: no login page, the configured user is signed in.
   */
  public readonly authorize = $route({
    path: "/realms/:realm/protocol/openid-connect/auth",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
      query: z.object({
        client_id: z.text(),
        redirect_uri: z.text({ size: "long" }),
        response_type: z.text(),
        scope: z.text().optional(),
        state: z.text().optional(),
        nonce: z.text().optional(),
        code_challenge: z.text().optional(),
        code_challenge_method: z.text().optional(),
      }),
    },
    handler: ({ params, query, reply }) => {
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }
      this.record("authorize", { clientId: query.client_id });

      const client = this.findClient(query.client_id);
      if (!client || query.response_type !== "code") {
        reply.status = 400;
        return { error: "invalid_request" };
      }
      if (
        client.redirectUris &&
        !client.redirectUris.includes(query.redirect_uri)
      ) {
        reply.status = 400;
        return { error: "invalid_redirect_uri" };
      }
      if (query.code_challenge && query.code_challenge_method !== "S256") {
        reply.status = 400;
        return { error: "invalid_request" };
      }

      const code = this.crypto.randomUUID();
      this.codes.set(code, {
        clientId: client.clientId,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        nonce: query.nonce,
        scope: query.scope ?? "openid",
      });

      const target = new URL(query.redirect_uri);
      target.searchParams.set("code", code);
      if (query.state) {
        target.searchParams.set("state", query.state);
      }
      reply.redirect(target.toString(), 302);
      return {};
    },
  });

  public readonly token = $route({
    path: "/realms/:realm/protocol/openid-connect/token",
    method: "POST",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
      body: z.record(z.text(), z.any()),
    },
    handler: async ({ params, body, headers, reply }) => {
      reply.setHeader("cache-control", "no-store");
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }

      const form = body as Record<string, string | undefined>;
      const client = this.authenticateClient(form, headers.authorization);
      this.record("token", {
        clientId: client?.clientId,
        grantType: form.grant_type,
      });
      if (!client) {
        reply.status = 401;
        return { error: "invalid_client" };
      }

      if (form.grant_type === "authorization_code") {
        const code = form.code ? this.codes.get(form.code) : undefined;
        if (form.code) {
          this.codes.delete(form.code);
        }
        if (
          !code ||
          code.clientId !== client.clientId ||
          code.redirectUri !== form.redirect_uri ||
          !this.verifyPkce(code.codeChallenge, form.code_verifier)
        ) {
          reply.status = 400;
          return { error: "invalid_grant" };
        }

        return this.issueTokens({
          clientId: client.clientId,
          sid: this.crypto.randomUUID(),
          scope: code.scope,
          nonce: code.nonce,
        });
      }

      if (form.grant_type === "refresh_token") {
        const grant = form.refresh_token
          ? this.refreshTokens.get(form.refresh_token)
          : undefined;
        if (
          !grant ||
          grant.clientId !== client.clientId ||
          this.revoked.has(grant.refreshToken) ||
          grant.expiresAt <= this.dateTime.now().unix()
        ) {
          reply.status = 400;
          return { error: "invalid_grant" };
        }

        return this.issueTokens({
          clientId: client.clientId,
          sid: grant.sid,
          scope: grant.scope,
          previous: grant,
        });
      }

      reply.status = 400;
      return { error: "unsupported_grant_type" };
    },
  });

  /**
   * RP-initiated logout: ends the session named by `id_token_hint` and sends
   * the browser back.
   */
  public readonly endSession = $route({
    path: "/realms/:realm/protocol/openid-connect/logout",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
      query: z.object({
        id_token_hint: z.text({ size: "rich" }).optional(),
        post_logout_redirect_uri: z.text({ size: "long" }).optional(),
        client_id: z.text().optional(),
        state: z.text().optional(),
      }),
    },
    handler: ({ params, query, reply }) => {
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }
      this.record("endSession", {
        idTokenHint: query.id_token_hint,
        postLogoutRedirectUri: query.post_logout_redirect_uri,
      });

      const sid = query.id_token_hint
        ? this.decodePayload(query.id_token_hint).sid
        : undefined;
      if (typeof sid === "string") {
        for (const grant of this.refreshTokens.values()) {
          if (grant.sid === sid) {
            this.revoked.add(grant.refreshToken);
          }
        }
      }

      if (query.post_logout_redirect_uri) {
        reply.redirect(query.post_logout_redirect_uri, 302);
        return {};
      }
      return { ok: true };
    },
  });

  /**
   * RFC 7009 token revocation. Answers 200 for an unknown token, as the RFC
   * asks.
   */
  public readonly revocation = $route({
    path: "/realms/:realm/protocol/openid-connect/revoke",
    method: "POST",
    schema: {
      params: z.object({ realm: z.text() }),
      response: z.record(z.text(), z.any()),
      body: z.record(z.text(), z.any()),
    },
    handler: ({ params, body, headers, reply }) => {
      if (!this.matchesRealm(params.realm, reply)) {
        return { error: "realm_not_found" };
      }

      const form = body as Record<string, string | undefined>;
      const client = this.authenticateClient(form, headers.authorization);
      this.record("revocation", {
        clientId: client?.clientId,
        token: form.token,
        tokenTypeHint: form.token_type_hint,
      });
      if (!client) {
        reply.status = 401;
        return { error: "invalid_client" };
      }
      if (form.token) {
        this.revoked.add(form.token);
      }
      return {};
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected resolveOptions(options: MockOidcOptions): MockOidcResolvedOptions {
    return {
      realm: options.realm ?? "test",
      clients: options.clients ?? [{ clientId: "alepha" }],
      user: {
        sub: "user-1",
        name: "Ada Lovelace",
        given_name: "Ada",
        family_name: "Lovelace",
        email: "ada@example.com",
        email_verified: true,
        preferred_username: "ada",
        roles: [],
        ...options.user,
      },
      accessTokenTtl: options.accessTokenTtl ?? 300,
      refreshTokenTtl: options.refreshTokenTtl ?? 1800,
      audience: options.audience ?? "account",
      claims: options.claims,
      rotateRefreshTokens: options.rotateRefreshTokens ?? false,
      advertise: {
        endSession: true,
        revocation: true,
        backchannelLogout: true,
        ...options.advertise,
      },
    };
  }

  protected matchesRealm(realm: string, reply: ServerReply): boolean {
    if (realm === this.options.realm) {
      return true;
    }
    reply.status = 404;
    return false;
  }

  protected record(
    endpoint: MockOidcCall["endpoint"],
    data: Omit<MockOidcCall, "endpoint"> = {},
  ): void {
    this.calls.push({ endpoint, ...data });
  }

  protected findClient(clientId?: string): MockOidcClient | undefined {
    return this.options.clients.find((it) => it.clientId === clientId);
  }

  /**
   * `client_secret_basic`, `client_secret_post`, or `none` for a client with
   * no secret.
   */
  protected authenticateClient(
    form: Record<string, string | undefined>,
    authorization?: string,
  ): MockOidcClient | undefined {
    let clientId = form.client_id;
    let secret = form.client_secret;

    if (authorization?.startsWith("Basic ")) {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf8",
      );
      const index = decoded.indexOf(":");
      clientId = decodeURIComponent(decoded.slice(0, index));
      secret = decodeURIComponent(decoded.slice(index + 1));
    }

    const client = this.findClient(clientId);
    if (!client) {
      return undefined;
    }
    if (client.clientSecret && client.clientSecret !== secret) {
      return undefined;
    }
    return client;
  }

  protected verifyPkce(challenge?: string, verifier?: string): boolean {
    if (!challenge) {
      return true;
    }
    if (!verifier) {
      return false;
    }
    const computed = createHash("sha256").update(verifier).digest("base64url");
    return computed === challenge;
  }

  protected accessTokenClaims(grant: {
    clientId: string;
    sid: string;
    scope: string;
  }): JWTPayload {
    const iat = this.dateTime.now().unix();
    const { user } = this.options;
    const claims: JWTPayload = {
      iss: this.issuer,
      sub: user.sub,
      aud: this.options.audience,
      azp: grant.clientId,
      typ: "Bearer",
      sid: grant.sid,
      scope: grant.scope,
      iat,
      exp: iat + this.options.accessTokenTtl,
      jti: this.crypto.randomUUID(),
      name: user.name,
      given_name: user.given_name,
      family_name: user.family_name,
      email: user.email,
      email_verified: user.email_verified,
      preferred_username: user.preferred_username,
      realm_access: { roles: user.roles ?? [] },
    };
    return {
      ...claims,
      ...this.options.claims?.({ clientId: grant.clientId, sid: grant.sid }),
    };
  }

  protected async issueTokens(grant: {
    clientId: string;
    sid: string;
    scope: string;
    nonce?: string;
    previous?: MockOidcGrant;
  }): Promise<Record<string, unknown>> {
    const iat = this.dateTime.now().unix();
    const { user } = this.options;

    const accessToken = await this.sign(this.accessTokenClaims(grant));
    const idToken = await this.sign({
      iss: this.issuer,
      sub: user.sub,
      aud: grant.clientId,
      azp: grant.clientId,
      typ: "ID",
      sid: grant.sid,
      iat,
      exp: iat + this.options.accessTokenTtl,
      auth_time: grant.previous?.authTime ?? iat,
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
      name: user.name,
      given_name: user.given_name,
      family_name: user.family_name,
      email: user.email,
      email_verified: user.email_verified,
      preferred_username: user.preferred_username,
    });

    let refreshToken = grant.previous?.refreshToken;
    if (!refreshToken || this.options.rotateRefreshTokens) {
      if (refreshToken) {
        this.refreshTokens.delete(refreshToken);
      }
      refreshToken = this.crypto.randomUUID();
    }
    this.refreshTokens.set(refreshToken, {
      refreshToken,
      clientId: grant.clientId,
      sid: grant.sid,
      scope: grant.scope,
      authTime: grant.previous?.authTime ?? iat,
      expiresAt: iat + this.options.refreshTokenTtl,
    });

    return {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.options.accessTokenTtl,
      refresh_expires_in: this.options.refreshTokenTtl,
      scope: grant.scope,
      session_state: grant.sid,
    };
  }

  protected async getKeys(): Promise<{
    privateKey: CryptoKey;
    publicJwk: JWK;
  }> {
    if (!this.keys) {
      const { privateKey, publicKey } = await generateKeyPair("RS256", {
        extractable: true,
      });
      const publicJwk = {
        ...(await exportJWK(publicKey)),
        kid: "mock-oidc-1",
        alg: "RS256",
        use: "sig",
      };
      this.keys = { privateKey, publicJwk };
    }
    return this.keys;
  }

  protected async sign(payload: JWTPayload): Promise<string> {
    const { privateKey } = await this.getKeys();
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "mock-oidc-1", typ: "JWT" })
      .sign(privateKey);
  }

  protected decodePayload(token: string): Record<string, unknown> {
    try {
      return JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      );
    } catch (error) {
      throw new AlephaError("Not a JWT", { cause: error });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface MockOidcClient {
  clientId: string;
  /**
   * When set, the token and revocation endpoints require it, by
   * `client_secret_basic` or `client_secret_post`. Without it the client is
   * public and authenticates with its id alone.
   */
  clientSecret?: string;
  /**
   * When set, `redirect_uri` must be one of these.
   */
  redirectUris?: string[];
}

export interface MockOidcUser {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  /**
   * Signed into the access token as `realm_access.roles`, as Keycloak does.
   */
  roles?: string[];
}

export interface MockOidcOptions {
  /**
   * The realm in the issuer's path, `<origin>/realms/<realm>`.
   * @default "test"
   */
  realm?: string;
  /**
   * @default [{ clientId: "alepha" }]
   */
  clients?: MockOidcClient[];
  /**
   * The person every authorization request signs in.
   */
  user?: Partial<MockOidcUser>;
  /**
   * Access and id token lifetime, in seconds.
   * @default 300
   */
  accessTokenTtl?: number;
  /**
   * @default 1800
   */
  refreshTokenTtl?: number;
  /**
   * The access token's `aud`. Keycloak's default is `"account"`, with the
   * client in `azp`.
   * @default "account"
   */
  audience?: string | string[];
  /**
   * Members added to, or overriding, every access token.
   */
  claims?: (grant: {
    clientId: string;
    sid: string;
  }) => Record<string, unknown>;
  /**
   * Issue a new refresh token on every refresh and retire the old one.
   * @default false
   */
  rotateRefreshTokens?: boolean;
  /**
   * Which optional endpoints discovery advertises. All of them by default.
   */
  advertise?: {
    endSession?: boolean;
    revocation?: boolean;
    backchannelLogout?: boolean;
  };
}

export interface MockOidcResolvedOptions {
  realm: string;
  clients: MockOidcClient[];
  user: MockOidcUser;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  audience: string | string[];
  claims?: MockOidcOptions["claims"];
  rotateRefreshTokens: boolean;
  advertise: Required<NonNullable<MockOidcOptions["advertise"]>>;
}

export interface MockOidcCall {
  endpoint:
    | "discovery"
    | "jwks"
    | "authorize"
    | "token"
    | "endSession"
    | "revocation";
  clientId?: string;
  grantType?: string;
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  token?: string;
  tokenTypeHint?: string;
}

interface MockOidcCode {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  nonce?: string;
  scope: string;
}

interface MockOidcGrant {
  refreshToken: string;
  clientId: string;
  sid: string;
  scope: string;
  authTime: number;
  expiresAt: number;
}
