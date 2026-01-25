import { $inject, t } from "alepha";
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
    secure: true,
    description: "Find API keys with pagination and filtering",
    schema: {
      query: adminApiKeyQuerySchema,
      response: t.page(adminApiKeyResourceSchema),
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
    secure: true,
    description: "Get an API key by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
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
    secure: true,
    description: "Revoke an API key",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.apiKeyService.revokeByAdmin(params.id);
      return { ok: true, id: params.id };
    },
  });
}
