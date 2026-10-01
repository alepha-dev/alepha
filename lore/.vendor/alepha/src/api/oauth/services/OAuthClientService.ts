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
import { OAuthClientMetadataError } from "../errors/OAuthClientMetadataError.ts";
import { JtiReplayGuard } from "../helpers/jtiReplayGuard.ts";

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
  /**
   * First-party client — skip the consent screen (see the entity field).
   */
  trusted?: boolean;
  /**
   * Raw secret for a confidential client; stored as a scrypt hash.
   */
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
   * needs to cover the ~60s code lifetime, so an in-memory guard is
   * sufficient even on serverless — an expired code fails JWT verification
   * regardless.
   *
   * A plain `Set` here was described as bounded and was not: nothing ever
   * removed an entry, so a long-lived process accumulated one uuid per
   * authorization code it had ever issued, forever. `JtiReplayGuard` prunes
   * on expiry and caps its own size.
   */
  protected readonly usedCodes = new JtiReplayGuard();

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
   * Answers which of the given client ids still have a session.
   *
   * ⚠️ **Registered by `$realm`, exactly like {@link registerIssuer}, and
   * for the same reason.** `sessions` is `api/users`' table, `api/users`
   * already depends on this module, and the reverse edge is a crash rather
   * than a lint warning. So the dependency runs the way it already runs and
   * this module is handed a function.
   *
   * Absent, {@link clientIdsWithSessions} answers "all of them", so the
   * prune job deletes nothing. That is the right default for a probe whose
   * absence means "cannot tell": the failure of a cleanup is leaving rows,
   * never removing a client somebody is using.
   */
  protected sessionProbe?: (clientIds: string[]) => Promise<Set<string>>;

  public registerSessionProbe(
    probe: (clientIds: string[]) => Promise<Set<string>>,
  ): void {
    this.sessionProbe = probe;
  }

  /**
   * Of the given client ids, those a session still references.
   *
   * ⚠️ With no probe registered this returns every id it was given, so a
   * caller pruning "the ones nobody uses" prunes nothing. Fail closed: this
   * answer decides deletions.
   */
  public async clientIdsWithSessions(
    clientIds: string[],
  ): Promise<Set<string>> {
    if (!this.sessionProbe) {
      return new Set(clientIds);
    }
    return this.sessionProbe(clientIds);
  }

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
    // later be surfaced as a "connected app" and revoked individually, and
    // with the grant's scopes, which the issuer resolves into what the token
    // may do (and resolves again on every refresh, from the session row).
    const tokens = await entry.issuer.createToken(user, undefined, {
      clientId: grant.clientId,
      scopes: grant.scopes,
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
      throw new OAuthClientMetadataError(
        "invalid_redirect_uri",
        "At least one redirect_uri is required",
      );
    }
    for (const uri of options.redirectUris) {
      this.assertValidRedirectUri(uri);
    }

    const type = options.type ?? "public";
    if (type === "confidential" && !options.secret) {
      throw new OAuthClientMetadataError(
        "invalid_client_metadata",
        "A confidential client requires a secret",
      );
    }

    const reusable = await this.findReusableClient(options, type);
    if (reusable) {
      // Deliberately a DIFFERENT line from "OAuth client registered", so
      // the production logs show the dedupe working rather than looking
      // like a registration that never happened.
      this.log.info("OAuth client reused", {
        clientId: reusable.clientId,
        clientName: reusable.clientName,
      });
      return reusable;
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
   * Stamp a client as used, on every successful token grant.
   *
   * ⚠️ **The column existed and nothing wrote it**: all 44 production rows
   * held NULL, so "registered, used once, then abandoned" was
   * indistinguishable from "registered and never used". Writing it is what
   * lets that distinction exist at all, and it costs one UPDATE per
   * fifteen-minute refresh.
   *
   * Best effort by design: a token has already been minted by the time this
   * runs, and failing the grant because a bookkeeping write failed would
   * turn a cosmetic problem into an outage.
   */
  public async markClientUsed(clientId: string): Promise<void> {
    if (!clientId) {
      return;
    }
    try {
      const client = await this.findByClientId(clientId);
      if (!client) {
        return;
      }
      await this.repo.updateById(client.id, {
        lastUsedAt: this.dateTime.nowISOString(),
      });
    } catch (error) {
      this.log.warn("Could not stamp OAuth client as used", {
        clientId,
        error,
      });
    }
  }

  /**
   * An already-registered client this registration may be handed back
   * instead of minting a new one.
   *
   * ## Why this exists
   *
   * claude.ai never reuses its client registration: every connect runs
   * RFC 7591 Dynamic Client Registration, and this method used to insert
   * unconditionally. Production accumulated **39 rows named "Claude", of
   * which 7 ever got a session** - and, worse, one account's Connected apps
   * page listed four live-looking "Claude" entries, because four sessions
   * carried four different `client_id`s and nothing could tell they were the
   * same application.
   *
   * Reuse is what lets the connections list group by client at all.
   *
   * ## ⚠️ Every guard below is load-bearing
   *
   * - **`options.clientId` given** means somebody registered a specific
   *   client on purpose (Platform's OIDC seeder). Never dedupe those: the
   *   id is the contract.
   * - **Confidential clients never dedupe.** The caller would receive a
   *   `client_id` whose secret it does not hold, and every token request
   *   would then 401.
   * - **A revoked client is never resurrected.** Revocation is a deliberate
   *   act; handing the same id back defeats it.
   * - **Realm** scopes every other read in this service, and a client is a
   *   row in one realm.
   * - **`redirectUris` compare as a SET**, not as an ordered list: two
   *   registrations naming the same URIs in a different order are the same
   *   client, and one naming a URI the other does not is not.
   *
   * Sharing one `client_id` between two installs of the same public client
   * is safe, and is the same reasoning that lets `token_endpoint_auth_method:
   * "none"` work at all: for a public client the id is not a secret, PKCE
   * binds the code to the verifier, and the redirect_uri is matched exactly.
   *
   * ⚠️ **No index for this, on purpose.** The table holds tens of rows and
   * DCR is rate limited to ten per IP per fifteen minutes, so the scan is
   * cheaper than the migration an index would need. Measure before
   * disagreeing.
   */
  protected async findReusableClient(
    options: RegisterClientOptions,
    type: "public" | "confidential",
  ): Promise<OAuthClientEntity | undefined> {
    if (options.clientId || type !== "public" || options.secret) {
      return undefined;
    }
    const source = options.source ?? "dcr";
    if (source !== "dcr") {
      return undefined;
    }

    const candidates = await this.repo.findMany({
      where: {
        realm: { eq: options.realm },
        clientName: { eq: options.clientName || "OAuth Client" },
        source: { eq: "dcr" },
        type: { eq: "public" },
      },
    });

    // The set comparison happens here rather than in the query:
    // `FilterOperators` has no set equality, and the column is JSON on both
    // sqlite and postgres.
    const wanted = this.redirectUriKey(options.redirectUris);
    return candidates.find(
      (candidate) =>
        !candidate.revokedAt &&
        !candidate.clientSecretHash &&
        this.redirectUriKey(candidate.redirectUris) === wanted,
    );
  }

  /**
   * Order-insensitive, duplicate-insensitive identity of a redirect_uri
   * list, so two registrations naming the same set match however they
   * spelled the order.
   */
  protected redirectUriKey(uris: string[]): string {
    return [...new Set(uris)].sort().join("\n");
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
      throw new OAuthClientMetadataError(
        "invalid_redirect_uri",
        "At least one redirect_uri is required",
      );
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
   * Validate a registered redirect_uri: https, or http to the loopback
   * interface, and at most a single `*`, which must live inside the host
   * (see `redirectUriMatches` for the matching rule).
   *
   * ## The loopback, and only the loopback, may be plain http
   *
   * RFC 8252 §7.3 has a native app (a CLI, a desktop MCP client) listen on
   * the loopback interface and register `http://127.0.0.1:{port}/...` or
   * `http://[::1]:{port}/...`; §8.3 calls `localhost` NOT RECOMMENDED, and
   * it is accepted too because clients use it anyway. The code never leaves
   * the machine, which is what makes the missing TLS acceptable.
   *
   * ⚠️ The host is compared on the PARSED URL. This used to be
   * `startsWith("http://localhost")`, which refused the recommended
   * `127.0.0.1` form outright and accepted `http://localhost.example.com`
   * and `http://localhostevil.com`: a cleartext redirect to somebody else's
   * host.
   *
   * @throws {OAuthClientMetadataError} `invalid_redirect_uri`, which the DCR
   * route answers with a 400.
   */
  protected assertValidRedirectUri(uri: string): void {
    const refuse = (reason: string) =>
      new OAuthClientMetadataError("invalid_redirect_uri", `${reason}: ${uri}`);

    const stars = (uri.match(/\*/g) ?? []).length;
    if (stars > 1) {
      throw refuse("At most one '*' wildcard is allowed in redirect_uri");
    }
    let parsed: URL;
    try {
      parsed = new URL(uri.replace("*", this.wildcardLabel));
    } catch {
      throw refuse("Invalid redirect_uri");
    }
    const secure = parsed.protocol === "https:";
    const loopback =
      parsed.protocol === "http:" && this.isLoopbackHost(parsed.hostname);
    if (!secure && !loopback) {
      throw refuse("Invalid redirect_uri");
    }
    if (stars === 1) {
      const host = uri.slice(uri.indexOf("://") + 3).split("/")[0] ?? "";
      if (
        !host.includes("*") ||
        !parsed.hostname.includes(this.wildcardLabel)
      ) {
        throw refuse("Wildcard '*' is only allowed in the host");
      }
    }
  }

  /**
   * Whether a parsed URL's `hostname` names the loopback interface:
   * `localhost`, `127.0.0.1` or `[::1]` (WHATWG keeps the brackets on an
   * IPv6 hostname).
   */
  protected isLoopbackHost(hostname: string): boolean {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
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
      return (
        pattern === candidate || this.loopbackMatchesAnyPort(pattern, candidate)
      );
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
   * Whether `candidate` is the loopback redirect `pattern` on another port.
   *
   * RFC 8252 §7.3: the authorization server MUST allow any port at request
   * time for a loopback redirect, since a native app takes whichever port
   * the OS hands it on each run. A client that registered once and reuses
   * its id would otherwise work exactly once.
   *
   * Everything but the port still matches exactly: scheme, host, path,
   * query and fragment. Only a plain-http loopback pattern qualifies, so no
   * https redirect and no remote host ever gains a free port. PKCE is what
   * binds the code to the process that asked for it, which is what makes an
   * unpinned port safe on a host nobody else can reach.
   */
  protected loopbackMatchesAnyPort(
    pattern: string,
    candidate: string,
  ): boolean {
    let expected: URL;
    let actual: URL;
    try {
      expected = new URL(pattern);
      actual = new URL(candidate);
    } catch {
      return false;
    }
    return (
      expected.protocol === "http:" &&
      this.isLoopbackHost(expected.hostname) &&
      actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search &&
      actual.hash === expected.hash &&
      actual.username === "" &&
      actual.password === ""
    );
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
    if (this.usedCodes.wasUsed(jti, this.dateTime.nowMillis())) {
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

    this.usedCodes.check(jti, this.dateTime.nowMillis());
    return {
      userId: payload.sub as string,
      scopes: (payload.scopes as string[]) ?? [],
      resource: payload.resource as string | undefined,
      nonce: payload.nonce as string | undefined,
    };
  }
}
