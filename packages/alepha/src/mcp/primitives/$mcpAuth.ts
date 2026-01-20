import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { McpContext } from "../interfaces/McpTypes.ts";
import {
  type McpAuthContext,
  McpAuthProvider,
} from "../providers/McpAuthProvider.ts";

// Re-export types from provider
export type { McpAuthContext } from "../providers/McpAuthProvider.ts";

/**
 * Create an MCP authentication primitive.
 *
 * This primitive provides OAuth2 client credentials authentication
 * for MCP tools, resources, and prompts.
 *
 * @example
 * ```ts
 * class MyMcpServer {
 *   auth = $mcpAuth({
 *     name: "mcp",
 *     secret: "your-secret-key",
 *   });
 *
 *   protectedTool = $tool({
 *     description: "A protected tool",
 *     scopes: ["mcp:tools:protected"],
 *     handler: async ({ context }) => {
 *       const auth = context?.data as McpAuthContext;
 *       if (!auth.client) throw new Error("Unauthorized");
 *       return "success";
 *     },
 *   });
 * }
 * ```
 */
export const $mcpAuth = (
  options: McpAuthPrimitiveOptions,
): McpAuthPrimitive => {
  return createPrimitive(McpAuthPrimitive, options);
};

export interface McpAuthPrimitiveOptions {
  /**
   * Name of the issuer/realm for MCP tokens.
   * @default "mcp"
   */
  name?: string;

  /**
   * Secret key for signing and verifying JWT tokens.
   * Required for internal token issuance.
   */
  secret: string;

  /**
   * Default scopes granted to new clients.
   */
  defaultScopes?: string[];

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
 * MCP authentication primitive.
 *
 * This is a thin wrapper around McpAuthProvider that handles
 * configuration during initialization.
 */
export class McpAuthPrimitive extends Primitive<McpAuthPrimitiveOptions> {
  protected readonly provider = $inject(McpAuthProvider);

  /**
   * Get the configured realm name.
   */
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Get the access token expiration in seconds.
   */
  public get accessTokenExpiration(): number {
    return this.provider.accessTokenExpiration;
  }

  protected onInit(): void {
    this.provider.configure({
      name: this.name,
      secret: this.options.secret,
      accessTokenExpiration: this.options.accessTokenExpiration,
      allowAnonymous: this.options.allowAnonymous,
    });
  }

  /**
   * Create an access token for a client using client credentials.
   */
  public createClientToken(
    clientId: string,
    clientSecret: string,
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    return this.provider.createClientToken(clientId, clientSecret);
  }

  /**
   * Validate the authorization header and extract the client/user.
   */
  public authenticate(context?: McpContext): Promise<McpAuthContext> {
    return this.provider.authenticate(context);
  }

  /**
   * Check if the authenticated context has a specific scope.
   */
  public hasScope(authContext: McpAuthContext, scope: string): boolean {
    return this.provider.hasScope(authContext, scope);
  }

  /**
   * Require a specific scope, throwing ForbiddenError if not granted.
   */
  public requireScope(authContext: McpAuthContext, scope: string): void {
    this.provider.requireScope(authContext, scope);
  }
}

$mcpAuth[KIND] = McpAuthPrimitive;
