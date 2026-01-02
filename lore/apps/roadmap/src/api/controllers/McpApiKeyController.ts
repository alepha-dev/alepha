import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { CryptoProvider } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { type McpApiKey, mcpApiKeys } from "../entities/mcpApiKeys.ts";

export class McpApiKeyController {
  protected readonly log = $logger();
  protected readonly mcpApiKeys = $repository(mcpApiKeys);
  protected readonly crypto = new CryptoProvider();
  protected readonly dt = new DateTimeProvider();

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Create a new MCP API key for the current user.
   * Returns the raw token once - it cannot be retrieved later.
   */
  createApiKey = $action({
    schema: {
      body: t.object({
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
      // Check for duplicate name for this user
      const existing = await this.mcpApiKeys
        .findOne({
          where: {
            userId: { eq: user.id },
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

      const apiKey = await this.mcpApiKeys.create({
        userId: user.id,
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
   * List all API keys for the current user.
   */
  listApiKeys = $action({
    schema: {
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
    handler: async ({ user }) => {
      const keys = await this.mcpApiKeys.findMany({
        where: { userId: { eq: user.id } },
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
      const apiKey = await this.mcpApiKeys.findOne({
        where: { id: { eq: params.id } },
      });

      // Verify ownership - user can only revoke their own keys
      if (apiKey.userId !== user.id) {
        throw new ForbiddenError("Cannot revoke API key owned by another user");
      }

      await this.mcpApiKeys.deleteById(params.id);

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
    roles: string[];
  } | null> {
    // Find keys that might match (we need to check all since we can't reverse the hash)
    // This is not ideal for large numbers of keys, but works for now
    const allKeys = await this.mcpApiKeys.findMany({});

    for (const key of allKeys) {
      const isValid = await this.crypto.verifyPassword(token, key.tokenHash);
      if (isValid) {
        // Check expiration
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          return null;
        }

        // Update last used timestamp
        await this.mcpApiKeys.updateById(key.id, {
          lastUsedAt: this.dt.nowISOString(),
        });

        return {
          apiKey: key,
          userId: key.userId,
          roles: key.roles,
        };
      }
    }

    return null;
  }
}
