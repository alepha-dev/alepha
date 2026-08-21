import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { createApiKeyBodySchema } from "../schemas/createApiKeyBodySchema.ts";
import { createApiKeyResponseSchema } from "../schemas/createApiKeyResponseSchema.ts";
import { listApiKeyResponseSchema } from "../schemas/listApiKeyResponseSchema.ts";
import { revokeApiKeyParamsSchema } from "../schemas/revokeApiKeyParamsSchema.ts";
import { revokeApiKeyResponseSchema } from "../schemas/revokeApiKeyResponseSchema.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

/**
 * REST API controller for user's own API key management.
 * Users can create, list, and revoke their own API keys.
 */
export class ApiKeyController {
  protected readonly url = "/api-keys";
  protected readonly group = "api-keys";
  protected readonly apiKeyService = $inject(ApiKeyService);

  /**
   * Create a new API key for the authenticated user.
   * The token is only returned once upon creation.
   */
  public readonly createApiKey = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    description: "Create a new API key",
    use: [$secure({ permissions: ["api-key:create"] })],
    schema: {
      body: createApiKeyBodySchema,
      response: createApiKeyResponseSchema,
    },
    handler: async (request) => {
      const { apiKey, token } = await this.apiKeyService.create({
        userId: request.user.id,
        name: request.body.name,
        description: request.body.description,
        roles: request.user.roles ?? [],
        expiresAt: request.body.expiresAt
          ? new Date(request.body.expiresAt)
          : undefined,
      });

      return {
        id: apiKey.id,
        name: apiKey.name,
        token,
        tokenSuffix: apiKey.tokenSuffix,
        roles: apiKey.roles,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
      };
    },
  });

  /**
   * List all active API keys for the authenticated user.
   * Does not return the actual tokens.
   */
  public readonly listApiKeys = $action({
    path: this.url,
    group: this.group,
    description: "List your API keys",
    use: [$secure({ permissions: ["api-key:read"] })],
    schema: {
      response: listApiKeyResponseSchema,
    },
    handler: async (request) => {
      const apiKeys = await this.apiKeyService.list(request.user.id);

      return apiKeys.map((apiKey) => ({
        id: apiKey.id,
        name: apiKey.name,
        tokenPrefix: apiKey.tokenPrefix,
        tokenSuffix: apiKey.tokenSuffix,
        roles: apiKey.roles,
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
        lastUsedIp: apiKey.lastUsedIp,
        expiresAt: apiKey.expiresAt,
        usageCount: apiKey.usageCount,
      }));
    },
  });

  /**
   * Revoke an API key. Only the owner can revoke their own keys.
   */
  public readonly revokeMyApiKey = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Revoke an API key",
    use: [$secure({ permissions: ["api-key:delete"] })],
    schema: {
      params: revokeApiKeyParamsSchema,
      response: revokeApiKeyResponseSchema,
    },
    handler: async (request) => {
      await this.apiKeyService.revoke(request.params.id, request.user.id);
      return { ok: true };
    },
  });
}
