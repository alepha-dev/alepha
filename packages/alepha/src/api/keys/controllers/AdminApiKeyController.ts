import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { adminApiKeyQuerySchema } from "../schemas/adminApiKeyQuerySchema.ts";
import { adminApiKeyResourceSchema } from "../schemas/adminApiKeyResourceSchema.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

/**
 * REST API controller for admin API key management.
 * Admins can list, view, and revoke any API key.
 */
export class AdminApiKeyController {
  protected readonly url = "/admin/api-keys";
  protected readonly group = "admin:api-keys";
  protected readonly apiKeyService = $inject(ApiKeyService);

  /**
   * Find all API keys with optional filtering.
   */
  public readonly findApiKeys = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:api-key:read"] })],
    description: "Find API keys with pagination and filtering",
    schema: {
      query: adminApiKeyQuerySchema,
      response: z.page(adminApiKeyResourceSchema),
    },
    handler: ({ query }) => {
      const { userId, includeRevoked, ...pagination } = query;
      return this.apiKeyService.findAll({
        userId,
        includeRevoked,
        ...pagination,
      });
    },
  });

  /**
   * Get an API key by ID.
   */
  public readonly getApiKey = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:api-key:read"] })],
    description: "Get an API key by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: adminApiKeyResourceSchema,
    },
    handler: ({ params }) => this.apiKeyService.getById(params.id),
  });

  /**
   * Revoke any API key.
   */
  public readonly revokeApiKey = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:api-key:delete"] })],
    description: "Revoke an API key",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.apiKeyService.revokeByAdmin(params.id);
      return { ok: true, id: params.id };
    },
  });

  /**
   * Revoke many API keys in one request.
   */
  public readonly revokeApiKeys = $action({
    method: "POST",
    path: `${this.url}/revoke`,
    group: this.group,
    use: [$secure({ permissions: ["admin:api-key:delete"] })],
    description: "Revoke many API keys",
    schema: {
      body: z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
      }),
      response: z.object({
        revoked: z.array(z.uuid()),
      }),
    },
    handler: async ({ body }) => {
      const revoked = await this.apiKeyService.revokeManyByAdmin(body.ids);
      return { revoked };
    },
  });
}
