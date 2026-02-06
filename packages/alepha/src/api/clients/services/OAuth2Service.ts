import { randomBytes, timingSafeEqual } from "node:crypto";
import { $inject, Alepha } from "alepha";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  type AccessTokenResponse,
  CryptoProvider,
  type IssuerPrimitive,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { BadRequestError } from "alepha/server";
import { calculatePKCECodeChallenge } from "openid-client";
import {
  type OAuthClientEntity,
  oauthClientEntity,
} from "../entities/oauthClientEntity.ts";
import { oauthGrantEntity } from "../entities/oauthGrantEntity.ts";

// -----------------------------------------------------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------------------------------------------------

export interface AuthorizationCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource?: string;
  sessionId?: string;
  createdAt: number;
  consumed: boolean;
}

export interface ValidatedAuthorizationRequest {
  client: OAuthClientEntity;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state?: string;
  resource?: string;
}

export interface OAuth2Error {
  error: string;
  error_description?: string;
}

// -----------------------------------------------------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------------------------------------------------

export class OAuth2Service {
  protected readonly alepha = $inject(Alepha);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly jwtProvider = $inject(JwtProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();

  protected readonly clientRepo = $repository(oauthClientEntity);
  protected readonly grantRepo = $repository(oauthGrantEntity);

  /**
   * Issuer primitive — set by the module when wired into $realm.
   */
  public issuer!: IssuerPrimitive;

  /**
   * Realm name — set by the module when wired into $realm.
   */
  public realmName!: string;

  /**
   * Authorization codes — short-lived, one-time use.
   */
  protected readonly codes = $cache<AuthorizationCode, [string]>({
    name: "oauth2-authorization-codes",
    ttl: [10, "minutes"],
  });

  /**
   * Revoked tokens — tracked until their natural expiry.
   */
  protected readonly revokedTokens = $cache<boolean, [string]>({
    name: "oauth2-revoked-tokens",
    ttl: [1, "hour"],
  });

  // -------------------------------------------------------------------------
  // Client Management
  // -------------------------------------------------------------------------

  /**
   * Create a new OAuth2 client.
   * Returns the client entity and the plain secret (only for confidential clients).
   */
  public async createClient(options: {
    name: string;
    redirectUris: string[];
    description?: string;
    logoUri?: string;
    clientUri?: string;
    grantTypes?: string[];
    scopes?: string[];
    tokenEndpointAuthMethod?:
      | "none"
      | "client_secret_basic"
      | "client_secret_post";
    firstParty?: boolean;
  }): Promise<{ client: OAuthClientEntity; clientSecret?: string }> {
    const clientId = randomBytes(16).toString("base64url");
    const authMethod = options.tokenEndpointAuthMethod ?? "client_secret_basic";
    const isConfidential = authMethod !== "none";

    let clientSecretHash: string | undefined;
    let clientSecret: string | undefined;

    if (isConfidential) {
      clientSecret = `cs_${randomBytes(32).toString("base64url")}`;
      clientSecretHash = await this.cryptoProvider.hashPassword(clientSecret);
    }

    const client = await this.clientRepo.create({
      realm: this.realmName,
      clientId,
      clientSecretHash,
      name: options.name,
      description: options.description,
      logoUri: options.logoUri,
      clientUri: options.clientUri,
      redirectUris: options.redirectUris,
      grantTypes: options.grantTypes ?? ["authorization_code"],
      scopes: options.scopes ?? [],
      tokenEndpointAuthMethod: authMethod,
      firstParty: options.firstParty ?? false,
    });

    this.log.info("OAuth2 client created", {
      clientId: client.clientId,
      name: client.name,
      realm: this.realmName,
    });

    return { client, clientSecret };
  }

  /**
   * Get a client by clientId.
   */
  public async getClient(clientId: string): Promise<OAuthClientEntity> {
    return await this.clientRepo.getOne({
      where: {
        clientId: { eq: clientId },
        realm: { eq: this.realmName },
      },
    });
  }

  /**
   * Authenticate a client using clientId and optional clientSecret.
   */
  public async authenticateClient(
    clientId: string,
    clientSecret?: string,
    method?: string,
  ): Promise<OAuthClientEntity> {
    const client = await this.getClient(clientId);

    if (!client.enabled) {
      throw this.oauth2Error("invalid_client", "Client is disabled");
    }

    // Public client (no secret required)
    if (client.tokenEndpointAuthMethod === "none") {
      return client;
    }

    // Confidential client — secret required
    if (!clientSecret) {
      throw this.oauth2Error(
        "invalid_client",
        "Client authentication required",
      );
    }

    if (!client.clientSecretHash) {
      throw this.oauth2Error(
        "invalid_client",
        "Client has no secret configured",
      );
    }

    const valid = await this.cryptoProvider.verifyPassword(
      clientSecret,
      client.clientSecretHash,
    );

    if (!valid) {
      throw this.oauth2Error("invalid_client", "Invalid client credentials");
    }

    return client;
  }

  /**
   * Find all clients with optional filtering (admin only).
   */
  public async findClients(query: {
    enabled?: boolean;
    firstParty?: boolean;
    page?: number;
    size?: number;
    sort?: string;
  }) {
    query.sort ??= "-createdAt";

    const where = this.clientRepo.createQueryWhere();
    where.realm = { eq: this.realmName };

    if (query.enabled !== undefined) {
      where.enabled = { eq: query.enabled };
    }

    if (query.firstParty !== undefined) {
      where.firstParty = { eq: query.firstParty };
    }

    return this.clientRepo.paginate(query, { where }, { count: true });
  }

  /**
   * Get client by ID (admin only).
   */
  public async getClientById(id: string): Promise<OAuthClientEntity> {
    return await this.clientRepo.getById(id);
  }

  /**
   * Disable a client (admin only).
   */
  public async disableClient(id: string): Promise<void> {
    const client = await this.getClientById(id);

    await this.clientRepo.updateById(client.id, {
      enabled: false,
    });

    this.log.info("OAuth2 client disabled", {
      clientId: client.clientId,
      name: client.name,
    });
  }

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  /**
   * Validate an authorization request.
   */
  public async validateAuthorizationRequest(params: {
    response_type?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    state?: string;
    resource?: string;
  }): Promise<ValidatedAuthorizationRequest> {
    // Validate response_type
    if (params.response_type !== "code") {
      throw this.oauth2Error(
        "unsupported_response_type",
        "Only response_type=code is supported",
      );
    }

    // Validate client_id
    if (!params.client_id) {
      throw this.oauth2Error("invalid_request", "client_id is required");
    }

    const client = await this.getClient(params.client_id);

    if (!client.enabled) {
      throw this.oauth2Error("invalid_client", "Client is disabled");
    }

    // Validate redirect_uri (exact match)
    if (!params.redirect_uri) {
      throw this.oauth2Error("invalid_request", "redirect_uri is required");
    }

    if (!client.redirectUris.includes(params.redirect_uri)) {
      throw this.oauth2Error(
        "invalid_request",
        "redirect_uri does not match any registered URIs",
      );
    }

    // Validate PKCE (mandatory per OAuth 2.1)
    if (!params.code_challenge) {
      throw this.oauth2Error(
        "invalid_request",
        "code_challenge is required (PKCE)",
      );
    }

    if (params.code_challenge_method !== "S256") {
      throw this.oauth2Error(
        "invalid_request",
        "code_challenge_method must be S256",
      );
    }

    // Validate scopes
    const requestedScopes = params.scope ? params.scope.split(" ") : [];
    if (client.scopes.length > 0) {
      for (const scope of requestedScopes) {
        if (!client.scopes.includes(scope)) {
          throw this.oauth2Error(
            "invalid_scope",
            `Scope '${scope}' is not allowed for this client`,
          );
        }
      }
    }

    // Validate grant type
    if (!client.grantTypes.includes("authorization_code")) {
      throw this.oauth2Error(
        "unauthorized_client",
        "Client is not authorized for authorization_code grant",
      );
    }

    // Validate response type
    if (!client.responseTypes.includes("code")) {
      throw this.oauth2Error(
        "unsupported_response_type",
        "Client is not configured for response_type=code",
      );
    }

    return {
      client,
      redirectUri: params.redirect_uri,
      scopes: requestedScopes,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: "S256",
      state: params.state,
      resource: params.resource,
    };
  }

  /**
   * Create an authorization code for a validated request.
   */
  public async createAuthorizationCode(
    userId: string,
    validated: ValidatedAuthorizationRequest,
  ): Promise<string> {
    const code = randomBytes(32).toString("base64url");

    const authCode: AuthorizationCode = {
      clientId: validated.client.clientId,
      userId,
      redirectUri: validated.redirectUri,
      scopes: validated.scopes,
      codeChallenge: validated.codeChallenge,
      codeChallengeMethod: validated.codeChallengeMethod,
      resource: validated.resource,
      createdAt: this.dateTimeProvider.now().unix(),
      consumed: false,
    };

    await this.codes.set(code, authCode);

    this.log.debug("Authorization code created", {
      clientId: validated.client.clientId,
      userId,
      scopes: validated.scopes,
    });

    return code;
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  /**
   * Check if a user has already consented to the given client and scopes.
   */
  public async hasConsent(
    userId: string,
    clientId: string,
    scopes: string[],
  ): Promise<boolean> {
    const grant = await this.grantRepo.findOne({
      where: {
        userId: { eq: userId },
        clientId: { eq: clientId },
        realm: { eq: this.realmName },
        revokedAt: { isNull: true },
      },
    });

    if (!grant) {
      return false;
    }

    // Check that all requested scopes are covered by the grant
    return scopes.every((scope) => grant.scopes.includes(scope));
  }

  /**
   * Save user consent for a client and scopes.
   */
  public async saveConsent(
    userId: string,
    clientId: string,
    scopes: string[],
  ): Promise<void> {
    const existing = await this.grantRepo.findOne({
      where: {
        userId: { eq: userId },
        clientId: { eq: clientId },
        realm: { eq: this.realmName },
      },
    });

    if (existing) {
      // Merge scopes
      const mergedScopes = [...new Set([...existing.scopes, ...scopes])];

      await this.grantRepo.updateById(existing.id, {
        scopes: mergedScopes,
        revokedAt: null,
      });
    } else {
      await this.grantRepo.create({
        userId,
        clientId,
        realm: this.realmName,
        scopes,
      });
    }

    this.log.info("Consent saved", { userId, clientId, scopes });
  }

  // -------------------------------------------------------------------------
  // Token Exchange
  // -------------------------------------------------------------------------

  /**
   * Exchange an authorization code for tokens.
   */
  public async exchangeCode(params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource?: string;
  }): Promise<AccessTokenResponse> {
    // Retrieve code from cache
    const authCode = await this.codes.get(params.code);

    if (!authCode) {
      throw this.oauth2Error(
        "invalid_grant",
        "Authorization code is invalid or expired",
      );
    }

    // Check one-time use
    if (authCode.consumed) {
      // Code reuse detected — potential theft
      await this.codes.invalidate(params.code);
      throw this.oauth2Error(
        "invalid_grant",
        "Authorization code has already been used",
      );
    }

    // Validate client_id matches
    if (authCode.clientId !== params.clientId) {
      throw this.oauth2Error("invalid_grant", "client_id does not match");
    }

    // Validate redirect_uri matches
    if (authCode.redirectUri !== params.redirectUri) {
      throw this.oauth2Error("invalid_grant", "redirect_uri does not match");
    }

    // Verify PKCE
    const valid = await this.verifyPKCE(
      params.codeVerifier,
      authCode.codeChallenge,
    );
    if (!valid) {
      throw this.oauth2Error("invalid_grant", "PKCE verification failed");
    }

    // Mark code as consumed
    authCode.consumed = true;
    await this.codes.set(params.code, authCode);

    // Load user and create tokens
    const userService = this.alepha.inject(
      (await import("alepha/api/users")).UserService,
    );
    const user = await userService.getUserById(authCode.userId, this.realmName);

    const tokens = await this.issuer.createToken(user);

    // Add scope to response
    if (authCode.scopes.length > 0) {
      tokens.scope = authCode.scopes.join(" ");
    }

    return tokens;
  }

  /**
   * Issue tokens via client_credentials grant.
   */
  public async clientCredentialsGrant(params: {
    client: OAuthClientEntity;
    scope?: string;
    resource?: string;
  }): Promise<AccessTokenResponse> {
    // Validate grant type
    if (!params.client.grantTypes.includes("client_credentials")) {
      throw this.oauth2Error(
        "unauthorized_client",
        "Client is not authorized for client_credentials grant",
      );
    }

    // Public clients cannot use client_credentials (no way to authenticate)
    if (params.client.tokenEndpointAuthMethod === "none") {
      throw this.oauth2Error(
        "unauthorized_client",
        "Public clients cannot use client_credentials grant",
      );
    }

    // Validate scopes
    const requestedScopes = params.scope ? params.scope.split(" ") : [];
    if (params.client.scopes.length > 0) {
      for (const scope of requestedScopes) {
        if (!params.client.scopes.includes(scope)) {
          throw this.oauth2Error(
            "invalid_scope",
            `Scope '${scope}' is not allowed for this client`,
          );
        }
      }
    }

    // Create a token with the client as subject
    const iat = this.dateTimeProvider.now().unix();
    const exp = iat + this.issuer.accessTokenExpiration.asSeconds();

    const access_token = await this.jwtProvider.create(
      {
        sub: `client:${params.client.clientId}`,
        exp,
        iat,
        aud: params.resource ?? this.issuer.name,
        client_id: params.client.clientId,
        roles: [],
        scope: requestedScopes.join(" "),
      },
      this.issuer.name,
    );

    return {
      access_token,
      token_type: "Bearer",
      expires_in: this.issuer.accessTokenExpiration.asSeconds(),
      issued_at: iat,
      scope: requestedScopes.length > 0 ? requestedScopes.join(" ") : undefined,
    };
  }

  /**
   * Refresh a token.
   */
  public async refreshTokenGrant(params: {
    client: OAuthClientEntity;
    refreshToken: string;
    scope?: string;
  }): Promise<AccessTokenResponse> {
    // Validate grant type
    if (!params.client.grantTypes.includes("refresh_token")) {
      throw this.oauth2Error(
        "unauthorized_client",
        "Client is not authorized for refresh_token grant",
      );
    }

    const { tokens } = await this.issuer.refreshToken(params.refreshToken);

    // If narrower scope requested, validate it's a subset
    if (params.scope && tokens.scope) {
      const originalScopes = tokens.scope.split(" ");
      const requestedScopes = params.scope.split(" ");
      for (const scope of requestedScopes) {
        if (!originalScopes.includes(scope)) {
          throw this.oauth2Error(
            "invalid_scope",
            "Requested scope exceeds original grant",
          );
        }
      }
      tokens.scope = params.scope;
    }

    return tokens;
  }

  // -------------------------------------------------------------------------
  // PKCE
  // -------------------------------------------------------------------------

  /**
   * Verify PKCE code_verifier against stored code_challenge.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  public async verifyPKCE(
    codeVerifier: string,
    codeChallenge: string,
  ): Promise<boolean> {
    try {
      const computed = await calculatePKCECodeChallenge(codeVerifier);
      const expected = Buffer.from(codeChallenge, "utf-8");
      const actual = Buffer.from(computed, "utf-8");

      if (expected.length !== actual.length) {
        return false;
      }

      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Introspection & Revocation
  // -------------------------------------------------------------------------

  /**
   * Introspect a token (RFC 7662).
   */
  public async introspect(token: string): Promise<Record<string, unknown>> {
    // Check if token is revoked
    const revoked = await this.revokedTokens.get(token);
    if (revoked) {
      return { active: false };
    }

    try {
      const payload = await this.issuer.parseToken(token);

      return {
        active: true,
        sub: payload.sub,
        client_id: payload.client_id as string | undefined,
        scope: payload.scope as string | undefined,
        exp: payload.exp,
        iat: payload.iat,
        aud: payload.aud,
        token_type: "Bearer",
      };
    } catch {
      return { active: false };
    }
  }

  /**
   * Revoke a token (RFC 7009).
   * Always returns success per spec (even if token is invalid).
   */
  public async revoke(token: string, clientId?: string): Promise<void> {
    try {
      // RFC 7009: verify token belongs to the requesting client
      if (clientId) {
        try {
          const payload = await this.issuer.parseToken(token);
          if (payload.client_id && payload.client_id !== clientId) {
            // Token belongs to a different client — silently ignore per RFC 7009
            return;
          }
        } catch {
          // Token is invalid/expired — still add to revocation list
        }
      }

      await this.revokedTokens.set(token, true);
    } catch (e) {
      this.log.warn("Failed to revoke token", { error: e });
    }
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /**
   * Get OAuth2 Authorization Server metadata (RFC 8414).
   */
  public getServerMetadata(baseUrl: string): Record<string, unknown> {
    const permissions = this.securityProvider
      .getPermissions()
      .map((p) => p.name);

    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth2/authorize`,
      token_endpoint: `${baseUrl}/oauth2/token`,
      revocation_endpoint: `${baseUrl}/oauth2/revoke`,
      introspection_endpoint: `${baseUrl}/oauth2/introspect`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
      ],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      scopes_supported: permissions,
      client_id_metadata_document_supported: true,
    };
  }

  /**
   * Get Protected Resource metadata (RFC 9728).
   */
  public getProtectedResourceMetadata(
    baseUrl: string,
  ): Record<string, unknown> {
    const permissions = this.securityProvider
      .getPermissions()
      .map((p) => p.name);

    return {
      resource: baseUrl,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: permissions,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse client credentials from Authorization header (Basic auth).
   */
  public parseBasicAuth(
    authorization?: string,
  ): { clientId: string; clientSecret: string } | undefined {
    if (!authorization?.startsWith("Basic ")) {
      return undefined;
    }

    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf-8",
      );
      const colonIndex = decoded.indexOf(":");
      if (colonIndex === -1) {
        return undefined;
      }

      return {
        clientId: decodeURIComponent(decoded.slice(0, colonIndex)),
        clientSecret: decodeURIComponent(decoded.slice(colonIndex + 1)),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Create an OAuth2 error.
   */
  protected oauth2Error(error: string, description?: string): BadRequestError {
    const err = new BadRequestError(description ?? error);
    (err as any).oauth2Error = error;
    (err as any).oauth2ErrorDescription = description;
    return err;
  }
}
