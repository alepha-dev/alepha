import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { apiKeyOptionsResponseSchema } from "../schemas/apiKeyOptionsResponseSchema.ts";
import { createApiKeyBodySchema } from "../schemas/createApiKeyBodySchema.ts";
import { createApiKeyResponseSchema } from "../schemas/createApiKeyResponseSchema.ts";
import { listApiKeyResponseSchema } from "../schemas/listApiKeyResponseSchema.ts";
import { revokeApiKeyParamsSchema } from "../schemas/revokeApiKeyParamsSchema.ts";
import { revokeApiKeyResponseSchema } from "../schemas/revokeApiKeyResponseSchema.ts";
import { rotateApiKeyBodySchema } from "../schemas/rotateApiKeyBodySchema.ts";
import { rotateApiKeyParamsSchema } from "../schemas/rotateApiKeyParamsSchema.ts";
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
    // A key must not mint a key: see `SecureOptions.sessionOnly`.
    use: [$secure({ permissions: ["api-key:create"], sessionOnly: true })],
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
        permissions: request.body.permissions,
        ipAllowlist: request.body.ipAllowlist,
        caller: request.user,
        expiresIn: request.body.expiresIn,
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
        permissions: apiKey.permissions,
        ipAllowlist: apiKey.ipAllowlist,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
      };
    },
  });

  /**
   * What the create dialog cannot guess: the expiry presets the policy admits
   * (with the default to preselect) and the permissions the caller may put in
   * a key's scope, which is its own ceiling, scope included.
   */
  public readonly getApiKeyOptions = $action({
    path: `${this.url}/options`,
    group: this.group,
    description: "Expiry policy and grantable permissions for a new API key",
    use: [$secure({ permissions: ["api-key:create"] })],
    schema: {
      response: apiKeyOptionsResponseSchema,
    },
    handler: (request) => this.apiKeyService.optionsFor(request.user),
  });

  /**
   * List the authenticated user's API keys, each with its derived `status`.
   * Does not return the actual tokens.
   *
   * ⚠️ Expired and revoked keys are listed too, until they are purged: the
   * length of this list is not a count of keys that work.
   */
  public readonly listApiKeys = $action({
    path: this.url,
    group: this.group,
    description: "List your API keys",
    use: [$secure({ permissions: ["api-key:read"] })],
    schema: {
      response: listApiKeyResponseSchema,
    },
    handler: (request) => this.apiKeyService.list(request.user.id),
  });

  /**
   * Rotate one of your API keys: a new secret on the same row, returned once.
   * The old token stops authenticating immediately.
   *
   * Owner only, and only from a signed-in session: a key cannot rotate a key.
   */
  public readonly rotateMyApiKey = $action({
    method: "POST",
    path: `${this.url}/:id/rotate`,
    group: this.group,
    description: "Rotate an API key",
    use: [$secure({ permissions: ["api-key:create"], sessionOnly: true })],
    schema: {
      params: rotateApiKeyParamsSchema,
      body: rotateApiKeyBodySchema,
      response: createApiKeyResponseSchema,
    },
    handler: async (request) => {
      const { apiKey, token } = await this.apiKeyService.rotate(
        request.params.id,
        request.user.id,
        { expiresIn: request.body.expiresIn },
      );
      return { ...this.apiKeyService.toView(apiKey), token };
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
    use: [$secure({ permissions: ["api-key:delete"], sessionOnly: true })],
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
