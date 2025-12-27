import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CryptoProvider } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";
import type { McpApiKey } from "../entities/mcpApiKeys.ts";
import { Db } from "../providers/Db.ts";
import { Security } from "../providers/Security.ts";

export class McpApiKeyController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);
  protected readonly security = $inject(Security);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dt = $inject(DateTimeProvider);

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Create a new MCP API key for a project.
   * Returns the raw token once - it cannot be retrieved later.
   */
  createApiKey = $action({
    schema: {
      body: t.object({
        projectId: t.integer(),
        name: t.string({ minLength: 1, maxLength: 100 }),
        expiresAt: t.optional(t.datetime()),
      }),
      response: t.object({
        id: t.uuid(),
        name: t.string(),
        token: t.string({
          description:
            "The raw API key token. Store it securely - it will not be shown again.",
        }),
        tokenSuffix: t.string(),
        createdAt: t.datetime(),
        expiresAt: t.optional(t.datetime()),
      }),
    },
    handler: async ({ body, user }) => {
      // Verify project ownership
      await this.security.checkOwnership(body.projectId, user);

      // Check for duplicate name
      const existing = await this.db.mcpApiKeys
        .findOne({
          where: {
            projectId: { eq: body.projectId },
            name: { eq: body.name },
          },
        })
        .catch(() => null);

      if (existing) {
        throw new BadRequestError("An API key with this name already exists");
      }

      // Generate token
      const rawToken = `rdm_${this.crypto.randomUUID().replace(/-/g, "")}`;
      const tokenHash = await this.crypto.hashPassword(rawToken);
      const tokenSuffix = rawToken.slice(-4);

      // Get user's current roles
      const roles = user.roles ?? [];

      const apiKey = await this.db.mcpApiKeys.create({
        userId: user.id,
        projectId: body.projectId,
        name: body.name,
        tokenHash,
        tokenSuffix,
        roles,
        expiresAt: body.expiresAt,
      });

      return {
        id: apiKey.id,
        name: apiKey.name,
        token: rawToken, // Only returned once
        tokenSuffix: apiKey.tokenSuffix,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
      };
    },
  });

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * List all API keys for a project.
   */
  listApiKeys = $action({
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.array(
        t.object({
          id: t.uuid(),
          name: t.string(),
          tokenSuffix: t.string(),
          createdAt: t.datetime(),
          lastUsedAt: t.optional(t.datetime()),
          expiresAt: t.optional(t.datetime()),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      const keys = await this.db.mcpApiKeys.findMany({
        where: { projectId: { eq: params.projectId } },
      });

      return keys.map((key) => ({
        id: key.id,
        name: key.name,
        tokenSuffix: key.tokenSuffix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
      }));
    },
  });

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Revoke (delete) an API key.
   */
  revokeApiKey = $action({
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const apiKey = await this.db.mcpApiKeys.findOne({
        where: { id: { eq: params.id } },
      });

      // Verify ownership
      await this.security.checkOwnership(apiKey.projectId, user);

      await this.db.mcpApiKeys.deleteById(params.id);

      return { ok: true };
    },
  });

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Validate an API key and return the associated context.
   * This is used internally by the MCP server.
   */
  public async validateApiKey(token: string): Promise<{
    apiKey: McpApiKey;
    userId: string;
    projectId: number;
    roles: string[];
  } | null> {
    // Find keys that might match (we need to check all since we can't reverse the hash)
    // This is not ideal for large numbers of keys, but works for now
    const allKeys = await this.db.mcpApiKeys.findMany({});

    for (const key of allKeys) {
      const isValid = await this.crypto.verifyPassword(token, key.tokenHash);
      if (isValid) {
        // Check expiration
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          return null;
        }

        // Update last used timestamp
        await this.db.mcpApiKeys.updateById(key.id, {
          lastUsedAt: this.dt.nowISOString(),
        });

        return {
          apiKey: key,
          userId: key.userId,
          projectId: key.projectId,
          roles: key.roles,
        };
      }
    }

    return null;
  }
}
