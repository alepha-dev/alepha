import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { McpContext } from "alepha/mcp";
import type { UserAccountToken } from "alepha/security";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "alepha/server";
import { McpApiKeyController } from "../api/controllers/McpApiKeyController.ts";
import { Db } from "../api/providers/Db.ts";

/**
 * Context data stored in McpContext.data for authenticated MCP requests.
 */
export interface McpAuthContext {
  user: UserAccountToken;
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
  protected readonly db = $inject(Db);

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

    return { user };
  }

  /**
   * Resolve a project by ID or name (title) for the authenticated user.
   * If no project identifier is provided, throws an error.
   *
   * @param auth - The authenticated user context
   * @param projectId - Optional project ID
   * @param projectName - Optional project name (title)
   * @returns The resolved project ID
   */
  public async resolveProject(
    auth: McpAuthContext,
    projectId?: number,
    projectName?: string,
  ): Promise<number> {
    if (projectId) {
      // Verify user has access to this project
      const project = await this.db.projects
        .findOne({
          where: { id: { eq: projectId } },
        })
        .catch(() => null);

      if (!project) {
        throw new NotFoundError(`Project with ID ${projectId} not found`);
      }

      // Check access: user is owner or has a character in the project
      if (project.createdBy !== auth.user.id) {
        const character = await this.db.characters
          .findOne({
            where: {
              projectId: { eq: projectId },
              userId: { eq: auth.user.id },
            },
          })
          .catch(() => null);

        if (!character && !project.public) {
          throw new NotFoundError(`Project with ID ${projectId} not found`);
        }
      }

      return projectId;
    }

    if (projectName) {
      // Search by title - find projects the user has access to
      const userProjects = await this.getUserProjects(auth);
      const project = userProjects.find(
        (p) => p.title.toLowerCase() === projectName.toLowerCase(),
      );

      if (!project) {
        throw new NotFoundError(`Project "${projectName}" not found`);
      }

      return project.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project name.",
    );
  }

  /**
   * Get all projects the user has access to.
   */
  public async getUserProjects(
    auth: McpAuthContext,
  ): Promise<Array<{ id: number; title: string; public: boolean }>> {
    // Get projects created by user
    const ownedProjects = await this.db.projects.findMany({
      where: { createdBy: { eq: auth.user.id } },
    });

    // Get projects where user has a character
    const characters = await this.db.characters.findMany({
      where: { userId: { eq: auth.user.id } },
    });

    const memberProjectIds = characters
      .map((c) => c.projectId)
      .filter((id) => !ownedProjects.some((p) => p.id === id));

    const memberProjects =
      memberProjectIds.length > 0
        ? await this.db.projects.findMany({
            where: { id: { inArray: memberProjectIds } },
          })
        : [];

    return [...ownedProjects, ...memberProjects].map((p) => ({
      id: p.id,
      title: p.title,
      public: p.public ?? false,
    }));
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
