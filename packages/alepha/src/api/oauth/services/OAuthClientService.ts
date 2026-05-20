import { createHash, randomUUID } from "node:crypto";
import { $inject, Alepha, AlephaError } from "alepha";
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

export interface RegisterClientOptions {
  realm: string;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
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

  /**
   * Codes already redeemed in this process. Single-use enforcement only
   * needs to cover the ~60s code lifetime, so a bounded in-memory set is
   * sufficient even on serverless — an expired code fails JWT verification
   * regardless.
   */
  protected readonly usedCodes = new Set<string>();

  /**
   * Registry of realm issuers used to mint access tokens. Populated by
   * `$realm` (via `registerIssuer`) so the OAuth module does not depend on the
   * realm wiring directly.
   */
  protected readonly issuers = new Map<
    string,
    {
      issuer: IssuerPrimitive;
      loadUser: (userId: string) => Promise<UserAccount>;
    }
  >();

  /**
   * Register a realm issuer and a user loader. Called by `$realm` so the
   * OAuth token endpoint can mint access tokens for that realm.
   */
  public registerIssuer(
    realm: string,
    issuer: IssuerPrimitive,
    loadUser: (userId: string) => Promise<UserAccount>,
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
      if (!uri.startsWith("https://") && !uri.startsWith("http://localhost")) {
        throw new AlephaError(`Invalid redirect_uri: ${uri}`);
      }
    }

    const clientId = `mcp_${randomUUID().replace(/-/g, "")}`;
    const client = await this.repo.create({
      clientId,
      clientName: options.clientName || "MCP Client",
      redirectUris: options.redirectUris,
      scopes: options.scopes,
      realm: options.realm,
      source: options.source ?? "dcr",
      createdByUserId: options.createdByUserId,
    });

    this.log.info("OAuth client registered", {
      clientId,
      source: client.source,
    });
    return client;
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
   * Exact-match redirect_uri check. OAuth 2.1 forbids substring/prefix
   * matching — the value must equal a registered URI byte-for-byte.
   */
  public isRedirectUriAllowed(
    client: OAuthClientEntity,
    redirectUri: string,
  ): boolean {
    return client.redirectUris.includes(redirectUri);
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
  ): Promise<{ userId: string; scopes: string[]; resource?: string }> {
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
    };
  }
}
