import { createHash, randomUUID } from "node:crypto";
import { $inject, Alepha, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  type IssuerPrimitive,
  JwtProvider,
  type UserAccount,
} from "alepha/security";
import {
  type OAuthClientEntity,
  oauthClientEntity,
} from "../entities/oauthClientEntity.ts";

/**
 * The user projection a realm's `loadUser` hands to the OAuth module —
 * a `UserAccount` plus the OIDC profile extras the id_token mints
 * (`email_verified`; `firstName`/`lastName` map to `given_name`/`family_name`).
 */
export interface OidcIssuerUser extends UserAccount {
  emailVerified?: boolean;
}

export interface RegisterClientOptions {
  realm: string;
  /**
   * Explicit client id (OIDC clients registered by Platform). When omitted,
   * a `mcp_<uuid>` id is generated (Dynamic Client Registration).
   */
  clientId?: string;
  clientName?: string;
  redirectUris: string[];
  scopes?: string[];
  /**
   * `confidential` clients require a `secret` (stored hashed) and authenticate
   * at the token endpoint. Defaults to `public` (PKCE only).
   */
  type?: "public" | "confidential";
  /** First-party client — skip the consent screen (see the entity field). */
  trusted?: boolean;
  /** Raw secret for a confidential client; stored as a scrypt hash. */
  secret?: string;
  source?: "dcr" | "user" | "admin";
  createdByUserId?: string;
}

/**
 * Core OAuth 2.1 service backing the authorization server.
 *
 * Responsibilities:
 * - Client registration (RFC 7591 Dynamic Client Registration) and lookup,
 *   with exact-match redirect_uri validation.
 * - Stateless PKCE authorization codes: minting short-lived signed JWTs that
 *   carry the grant, and verifying/consuming them (replay, expiry, client and
 *   redirect_uri checks, S256 PKCE).
 * - Realm issuer registry: realms register an issuer + user loader so the
 *   token endpoint can mint access tokens without depending on realm wiring.
 */
export class OAuthClientService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly repo = $repository(oauthClientEntity);
  protected readonly jwt = $inject(JwtProvider);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * Codes already redeemed in this process. Single-use enforcement only
   * needs to cover the ~60s code lifetime, so a bounded in-memory set is
   * sufficient even on serverless — an expired code fails JWT verification
   * regardless.
   */
  protected readonly usedCodes = new Set<string>();

  /**
   * Stand-in label substituted for the `*` of a registered redirect_uri so the
   * pattern can be parsed by `new URL()` like any other. Must be a valid
   * single hostname label; see `redirectUriMatches`.
   */
  protected readonly wildcardLabel = "alepha-wildcard-label";

  /**
   * Registry of realm issuers used to mint access tokens. Populated by
   * `$realm` (via `registerIssuer`) so the OAuth module does not depend on the
   * realm wiring directly.
   */
  protected readonly issuers = new Map<
    string,
    {
      issuer: IssuerPrimitive;
      loadUser: (userId: string) => Promise<OidcIssuerUser>;
    }
  >();

  /**
   * Register a realm issuer and a user loader. Called by `$realm` so the
   * OAuth token endpoint can mint access tokens for that realm.
   */
  public registerIssuer(
    realm: string,
    issuer: IssuerPrimitive,
    loadUser: (userId: string) => Promise<OidcIssuerUser>,
  ): void {
    this.issuers.set(realm, { issuer, loadUser });
  }

  /**
   * Mint an access token for a consumed authorization-code grant, using the
   * issuer registered for `realm`. Throws if the realm has no issuer.
   */
  public async issueAccessToken(
    realm: string,
    grant: {
      userId: string;
      scopes: string[];
      resource?: string;
      clientId?: string;
    },
  ): Promise<{
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  }> {
    const entry = this.issuers.get(realm);
    if (!entry) {
      throw new AlephaError(`No issuer registered for realm '${realm}'`);
    }
    const user = await entry.loadUser(grant.userId);
    // Tag the session the issuer creates with the OAuth client, so it can
    // later be surfaced as a "connected app" and revoked individually.
    const tokens = await entry.issuer.createToken(user, undefined, {
      clientId: grant.clientId,
    });
    return {
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
    };
  }

  /**
   * Mint an OIDC `id_token` for a consumed grant, signed by the realm's issuer
   * key (asymmetric when configured). Claims: iss, sub, aud (client_id), exp,
   * iat, nonce (when present), plus the standard profile claims the loader
   * provides: email, email_verified, name, given_name, family_name,
   * preferred_username, picture.
   */
  public async issueIdToken(
    realm: string,
    params: {
      userId: string;
      clientId: string;
      issuer: string;
      nonce?: string;
    },
  ): Promise<string> {
    const entry = this.issuers.get(realm);
    if (!entry) {
      throw new AlephaError(`No issuer registered for realm '${realm}'`);
    }
    const user = await entry.loadUser(params.userId);
    const iat = this.dateTime.now().unix();
    const exp = iat + entry.issuer.accessTokenExpiration.asSeconds();
    return this.jwt.create(
      {
        iss: params.issuer,
        sub: user.id,
        aud: params.clientId,
        exp,
        iat,
        ...(params.nonce ? { nonce: params.nonce } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.emailVerified !== undefined
          ? { email_verified: user.emailVerified }
          : {}),
        ...(user.name ? { name: user.name } : {}),
        ...(user.firstName ? { given_name: user.firstName } : {}),
        ...(user.lastName ? { family_name: user.lastName } : {}),
        ...(user.username ? { preferred_username: user.username } : {}),
        ...(user.picture ? { picture: user.picture } : {}),
      },
      realm,
      { header: { typ: "JWT" } },
    );
  }

  /**
   * Exchange a refresh token for a fresh access token (OAuth 2.1
   * `refresh_token` grant), using the issuer registered for `realm`. Lets an
   * MCP client stay connected for the refresh token's full lifetime without
   * re-running the authorization flow. Throws if the realm has no issuer or
   * the refresh token is invalid/expired.
   */
  public async refreshAccessToken(
    realm: string,
    refreshToken: string,
  ): Promise<{
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    /** Subject of the refreshed session — lets the token endpoint re-mint an
     * OIDC `id_token` for relying parties that forward it as the Bearer. */
    userId: string;
    /**
     * OAuth client the refreshed session was minted for, so the token endpoint
     * can refuse a client refreshing someone else's session.
     */
    clientId?: string;
  }> {
    const entry = this.issuers.get(realm);
    if (!entry) {
      throw new AlephaError(`No issuer registered for realm '${realm}'`);
    }
    const { tokens, user, clientId } =
      await entry.issuer.refreshToken(refreshToken);
    return {
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      userId: user.id,
      clientId,
    };
  }

  /**
   * Register a new OAuth client. Used by the RFC 7591 DCR endpoint and,
   * later, by user/admin UIs (via the `source` field).
   */
  public async register(
    options: RegisterClientOptions,
  ): Promise<OAuthClientEntity> {
    if (options.redirectUris.length === 0) {
      throw new AlephaError("At least one redirect_uri is required");
    }
    for (const uri of options.redirectUris) {
      this.assertValidRedirectUri(uri);
    }

    const type = options.type ?? "public";
    if (type === "confidential" && !options.secret) {
      throw new AlephaError("A confidential client requires a secret");
    }

    const clientId =
      options.clientId ?? `mcp_${randomUUID().replace(/-/g, "")}`;
    const clientSecretHash = options.secret
      ? await this.crypto.hashPassword(options.secret)
      : undefined;

    const client = await this.repo.create({
      clientId,
      clientName: options.clientName || "OAuth Client",
      redirectUris: options.redirectUris,
      scopes: options.scopes ?? ["openid"],
      realm: options.realm,
      type,
      trusted: options.trusted ?? false,
      clientSecretHash,
      source: options.source ?? "dcr",
      createdByUserId: options.createdByUserId,
    });

    this.log.info("OAuth client registered", {
      clientId,
      type,
      source: client.source,
    });
    return client;
  }

  /**
   * Idempotently align a registered client's redirect_uri allowlist with the
   * given list. No-op when the client is unknown or the list already matches —
   * safe to call from post-deploy seeders (allowlist changes ship as code, and
   * `register` alone would leave existing rows stale).
   */
  public async updateRedirectUris(
    clientId: string,
    redirectUris: string[],
  ): Promise<void> {
    if (redirectUris.length === 0) {
      throw new AlephaError("At least one redirect_uri is required");
    }
    for (const uri of redirectUris) {
      this.assertValidRedirectUri(uri);
    }
    const client = await this.findByClientId(clientId);
    if (!client) {
      return;
    }
    if (
      client.redirectUris.length === redirectUris.length &&
      client.redirectUris.every((uri, i) => uri === redirectUris[i])
    ) {
      return;
    }
    await this.repo.updateById(client.id, { redirectUris });
    this.log.info("OAuth client redirect_uris updated", {
      clientId,
      redirectUris,
    });
  }

  /**
   * Verify a confidential client's secret against its stored scrypt hash.
   * Returns false for unknown/revoked/public (no-hash) clients.
   */
  public async verifySecret(
    clientId: string,
    secret: string,
  ): Promise<boolean> {
    const client = await this.findByClientId(clientId);
    if (!client || client.revokedAt || !client.clientSecretHash) {
      return false;
    }
    return this.crypto.verifyPassword(secret, client.clientSecretHash);
  }

  /**
   * Validate a registered redirect_uri. https (or http://localhost) only, and
   * at most a single `*` which must live inside the host (see
   * `redirectUriMatches` for the matching rule).
   */
  protected assertValidRedirectUri(uri: string): void {
    const stars = (uri.match(/\*/g) ?? []).length;
    if (stars > 1) {
      throw new AlephaError(
        `At most one '*' wildcard is allowed in redirect_uri: ${uri}`,
      );
    }
    const probe = uri.replace("*", "wildcard");
    if (
      !probe.startsWith("https://") &&
      !probe.startsWith("http://localhost")
    ) {
      throw new AlephaError(`Invalid redirect_uri: ${uri}`);
    }
    if (stars === 1) {
      const host = uri.slice(uri.indexOf("://") + 3).split("/")[0] ?? "";
      if (!host.includes("*")) {
        throw new AlephaError(
          `Wildcard '*' is only allowed in the host: ${uri}`,
        );
      }
    }
  }

  /**
   * Look up a client by its public `clientId`. Returns null if unknown.
   */
  public async findByClientId(
    clientId: string,
  ): Promise<OAuthClientEntity | null> {
    return (
      (await this.repo.findOne({ where: { clientId: { eq: clientId } } })) ??
      null
    );
  }

  /**
   * Narrow the scopes a client asks for to those it is actually registered
   * for. The requested scope string is attacker-controlled, so it must never
   * be trusted verbatim — a client registered for `["mcp"]` that asks for
   * `mcp admin` must only be granted `mcp`. When nothing (usable) is
   * requested, the client's full registered set is the default grant.
   * Requested order is preserved and duplicates are dropped.
   */
  public intersectScopes(
    requested: string[] | undefined,
    allowed: string[],
  ): string[] {
    if (!requested || requested.length === 0) {
      return allowed;
    }
    const allowedSet = new Set(allowed);
    const granted: string[] = [];
    for (const scope of requested) {
      if (allowedSet.has(scope) && !granted.includes(scope)) {
        granted.push(scope);
      }
    }
    return granted;
  }

  /**
   * Redirect_uri check. A registered pattern is matched byte-exact unless it
   * contains a single `*`, which matches exactly ONE host label (no dots).
   * E.g. `https://*.alepha.club/auth/callback` matches
   * `https://b14.alepha.club/auth/callback` but NOT `https://alepha.club/...`
   * nor `https://a.b.alepha.club/...`.
   */
  public isRedirectUriAllowed(
    client: OAuthClientEntity,
    redirectUri: string,
  ): boolean {
    return client.redirectUris.some((pattern) =>
      this.redirectUriMatches(pattern, redirectUri),
    );
  }

  protected redirectUriMatches(pattern: string, candidate: string): boolean {
    if (!pattern.includes("*")) {
      return pattern === candidate;
    }
    // Never match the raw strings. `/`, `?`, `#` and `\` all terminate the
    // authority in WHATWG URL parsing, so any character class applied to the
    // pattern text can be escaped out of the host: `https://evil?.alepha.club/cb`
    // has host `evil`, yet a dot-free class accepts it. Compare parsed URLs
    // instead, and let the wildcard stand for one hostname label, nothing else.
    let expected: URL;
    let actual: URL;
    try {
      expected = new URL(pattern.replace("*", this.wildcardLabel));
      actual = new URL(candidate);
    } catch {
      return false;
    }

    if (
      expected.protocol !== actual.protocol ||
      expected.port !== actual.port ||
      expected.pathname !== actual.pathname ||
      expected.search !== actual.search ||
      expected.hash !== actual.hash
    ) {
      return false;
    }

    const expectedLabels = expected.hostname.split(".");
    const actualLabels = actual.hostname.split(".");
    if (expectedLabels.length !== actualLabels.length) {
      return false;
    }
    return expectedLabels.every((label, i) => {
      const candidateLabel = actualLabels[i] ?? "";
      return label === this.wildcardLabel
        ? /^[a-z0-9-]+$/.test(candidateLabel)
        : label === candidateLabel;
    });
  }

  /**
   * Mint a stateless authorization code: a short-lived signed JWT
   * (`typ: "oauth_code"`) carrying the grant. No server-side code storage.
   */
  public async createAuthorizationCode(
    realm: string,
    grant: {
      userId: string;
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      scopes: string[];
      resource?: string;
      nonce?: string;
    },
  ): Promise<string> {
    const iat = this.dateTime.now().unix();
    return this.jwt.create(
      {
        sub: grant.userId,
        client_id: grant.clientId,
        redirect_uri: grant.redirectUri,
        code_challenge: grant.codeChallenge,
        scopes: grant.scopes,
        resource: grant.resource,
        nonce: grant.nonce,
        iat,
        exp: iat + 60,
        jti: randomUUID(),
      },
      realm,
      { header: { typ: "oauth_code" } },
    );
  }

  /**
   * Verify and atomically consume an authorization code. Throws on expiry,
   * replay, client/redirect mismatch, or PKCE failure.
   */
  public async consumeAuthorizationCode(
    realm: string,
    code: string,
    check: { clientId: string; redirectUri: string; codeVerifier: string },
  ): Promise<{
    userId: string;
    scopes: string[];
    resource?: string;
    nonce?: string;
  }> {
    const { result } = await this.jwt.parse(code, realm, {
      typ: "oauth_code",
    });
    const payload = result.payload as Record<string, unknown>;

    const jti = payload.jti as string;
    if (this.usedCodes.has(jti)) {
      throw new AlephaError("Authorization code already used");
    }
    if (payload.client_id !== check.clientId) {
      throw new AlephaError("client_id mismatch");
    }
    if (payload.redirect_uri !== check.redirectUri) {
      throw new AlephaError("redirect_uri mismatch");
    }

    const computed = createHash("sha256")
      .update(check.codeVerifier)
      .digest("base64url");
    if (computed !== payload.code_challenge) {
      throw new AlephaError("PKCE verification failed");
    }

    this.usedCodes.add(jti);
    return {
      userId: payload.sub as string,
      scopes: (payload.scopes as string[]) ?? [],
      resource: payload.resource as string | undefined,
      nonce: payload.nonce as string | undefined,
    };
  }
}
