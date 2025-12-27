import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { McpContext } from "alepha/mcp";
import type { UserAccountToken } from "alepha/security";
import { UnauthorizedError } from "alepha/server";
import { McpApiKeyController } from "../api/controllers/McpApiKeyController.ts";

/**
 * Context data stored in McpContext.data for authenticated MCP requests.
 */
export interface McpAuthContext {
  user: UserAccountToken;
  projectId: number;
}

/**
 * Provider for MCP Bearer token authentication.
 *
 * Extracts the Bearer token from the Authorization header,
 * validates it against the database, and returns user context.
 */
export class McpAuth {
  protected readonly log = $logger();
  protected readonly apiKeyController = $inject(McpApiKeyController);

  /**
   * Extract and validate Bearer token from MCP context.
   *
   * @param context - The MCP context containing headers
   * @returns The authenticated user context
   * @throws UnauthorizedError if token is missing or invalid
   */
  public async authenticate(context?: McpContext): Promise<McpAuthContext> {
    const authHeader = context?.headers?.authorization;
    if (!authHeader) {
      throw new UnauthorizedError("Missing Authorization header");
    }

    const token = this.extractBearerToken(
      typeof authHeader === "string" ? authHeader : authHeader[0],
    );

    if (!token) {
      throw new UnauthorizedError("Invalid Authorization header format");
    }

    const result = await this.apiKeyController.validateApiKey(token);
    if (!result) {
      throw new UnauthorizedError("Invalid or expired API key");
    }

    // Construct a UserAccountToken-like object from the API key
    const user: UserAccountToken = {
      id: result.userId,
      email: "", // Not needed for MCP operations
      username: undefined,
      roles: result.roles,
      ownership: true, // API key implies ownership access
      sessionId: result.apiKey.id, // Use API key ID as session ID for tracking
    };

    return {
      user,
      projectId: result.projectId,
    };
  }

  /**
   * Extract Bearer token from Authorization header.
   */
  protected extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return null;
    }

    return parts[1];
  }
}
