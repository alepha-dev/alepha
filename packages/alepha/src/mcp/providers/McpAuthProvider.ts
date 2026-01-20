import { $inject } from "alepha";
import {
  DateTimeProvider,
  type Duration,
  type DurationLike,
} from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  JwtProvider,
  SecurityProvider,
  type UserAccount,
} from "alepha/security";
import type { OAuthClientEntity } from "../entities/oauthClients.ts";
import { McpForbiddenError, McpUnauthorizedError } from "../errors/McpError.ts";
import type { McpContext } from "../interfaces/McpTypes.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * MCP authentication context data.
 */
export interface McpAuthContext {
  /**
   * The authenticated client (for OAuth2 client credentials).
   */
  client?: OAuthClientEntity;

  /**
   * The authenticated user (for user tokens).
   */
  user?: UserAccount;

  /**
   * The scopes granted to the client/user.
   */
  scopes?: string[];

  /**
   * The raw access token.
   */
  token?: string;
}

export interface McpAuthProviderConfig {
  /**
   * Name of the issuer/realm for MCP tokens.
   */
  name: string;

  /**
   * Secret key for signing and verifying JWT tokens.
   */
  secret: string;

  /**
   * Access token lifetime.
   * @default [1, "hour"]
   */
  accessTokenExpiration?: DurationLike;

  /**
   * Whether to allow anonymous access (no token required).
   * @default false
   */
  allowAnonymous?: boolean;
}

/**
 * Provider that handles MCP OAuth2 authentication logic.
 *
 * This provider is responsible for:
 * - Creating access tokens for OAuth2 clients
 * - Validating bearer tokens from MCP requests
 * - Scope-based authorization
 */
export class McpAuthProvider {
  protected readonly log = $logger();
  protected readonly jwt = $inject(JwtProvider);
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly oauthClientService = $inject(OAuthClientService);

  protected config?: McpAuthProviderConfig;
  protected accessTokenDuration?: Duration;

  /**
   * Configure the auth provider with the given settings.
   * Called by the $mcpAuth primitive during initialization.
   */
  public configure(config: McpAuthProviderConfig): void {
    this.config = config;
    this.accessTokenDuration = this.dateTimeProvider.duration(
      config.accessTokenExpiration ?? [1, "hour"],
    );

    // Register the MCP realm with the security provider
    this.securityProvider.createRealm({
      name: config.name,
      secret: config.secret,
      roles: [
        {
          name: "mcp:client",
          permissions: [{ name: "mcp:*" }],
        },
      ],
    });
  }

  /**
   * Get the configured realm name.
   */
  public get name(): string {
    if (!this.config) {
      throw new Error("McpAuthProvider not configured");
    }
    return this.config.name;
  }

  /**
   * Get the access token expiration in seconds.
   */
  public get accessTokenExpiration(): number {
    if (!this.accessTokenDuration) {
      throw new Error("McpAuthProvider not configured");
    }
    return this.accessTokenDuration.asSeconds();
  }

  /**
   * Whether anonymous access is allowed.
   */
  public get allowAnonymous(): boolean {
    return this.config?.allowAnonymous ?? false;
  }

  /**
   * Create an access token for a client using client credentials.
   */
  public async createClientToken(
    clientId: string,
    clientSecret: string,
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    const client = await this.oauthClientService.validateCredentials(
      clientId,
      clientSecret,
    );

    if (!client) {
      throw new McpUnauthorizedError("Invalid client credentials");
    }

    const iat = this.dateTimeProvider.now().unix();
    const exp = iat + this.accessTokenExpiration;

    const payload = {
      sub: client.id,
      iat,
      exp,
      aud: this.name,
      client_id: client.clientId,
      scope: client.scopes.join(" "),
      // Custom claims for MCP
      mcp_client: true,
      mcp_client_name: client.name,
    };

    const access_token = await this.jwt.create(payload, this.name);

    return {
      access_token,
      token_type: "Bearer",
      expires_in: this.accessTokenExpiration,
      scope: client.scopes.join(" "),
    };
  }

  /**
   * Validate the authorization header and extract the client/user.
   */
  public async authenticate(context?: McpContext): Promise<McpAuthContext> {
    const authHeader = this.extractAuthHeader(context);

    // No auth header
    if (!authHeader) {
      if (this.allowAnonymous) {
        return {};
      }
      throw new McpUnauthorizedError("Authorization header required");
    }

    // Parse Bearer token
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      throw new McpUnauthorizedError("Invalid authorization scheme");
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new McpUnauthorizedError("Token required");
    }

    try {
      const { result } = await this.jwt.parse(token, this.name);
      const payload = result.payload;

      // Check if this is a client token
      if (payload.mcp_client) {
        const scopes = payload.scope ? String(payload.scope).split(" ") : [];

        return {
          client: {
            id: String(payload.sub),
            clientId: String(payload.client_id),
            name: String(payload.mcp_client_name),
            scopes,
            enabled: true,
          } as OAuthClientEntity,
          scopes,
          token,
        };
      }

      // Otherwise it's a user token
      const user = this.securityProvider.createUserFromPayload(
        payload,
        this.name,
      );

      return {
        user,
        scopes: user.roles ?? [],
        token,
      };
    } catch (error) {
      this.log.debug("Token validation failed", { error });
      throw new McpUnauthorizedError("Invalid or expired token");
    }
  }

  /**
   * Check if the authenticated context has a specific scope.
   */
  public hasScope(authContext: McpAuthContext, scope: string): boolean {
    const scopes = authContext.scopes ?? [];

    // Check for exact match
    if (scopes.includes(scope)) {
      return true;
    }

    // Check for wildcard patterns
    for (const grantedScope of scopes) {
      if (grantedScope === "*") {
        return true;
      }

      if (grantedScope.endsWith(":*")) {
        const prefix = grantedScope.slice(0, -1);
        if (scope.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Require a specific scope, throwing ForbiddenError if not granted.
   */
  public requireScope(authContext: McpAuthContext, scope: string): void {
    if (!this.hasScope(authContext, scope)) {
      throw new McpForbiddenError(`Scope '${scope}' required`);
    }
  }

  /**
   * Extract the authorization header from the MCP context.
   */
  protected extractAuthHeader(context?: McpContext): string | undefined {
    if (!context?.headers) {
      return undefined;
    }

    const auth = context.headers.authorization ?? context.headers.Authorization;

    if (Array.isArray(auth)) {
      return auth[0];
    }

    return auth;
  }
}
