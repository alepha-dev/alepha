import { $inject, t } from "@alepha/core";
import { pg } from "@alepha/orm";
import { $action, okSchema } from "@alepha/server";
import { identityQuerySchema } from "../schemas/identityQuerySchema.ts";
import { identityResourceSchema } from "../schemas/identityResourceSchema.ts";
import { IdentityService } from "../services/IdentityService.ts";

export class IdentityController {
  protected readonly url = "/identities";
  protected readonly group = "identities";
  protected readonly identityService = $inject(IdentityService);

  /**
   * Find identities with pagination and filtering.
   */
  public readonly findIdentities = $action({
    path: this.url,
    group: this.group,
    description: "Find identities with pagination and filtering",
    schema: {
      query: identityQuerySchema,
      response: pg.page(identityResourceSchema),
    },
    handler: ({ query }) => this.identityService.findIdentities(query),
  });

  /**
   * Get an identity by ID.
   */
  public readonly getIdentity = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Get an identity by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: identityResourceSchema,
    },
    handler: ({ params }) => this.identityService.getIdentityById(params.id),
  });

  /**
   * Delete an identity.
   */
  public readonly deleteIdentity = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete an identity",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.identityService.deleteIdentity(params.id);
      return { ok: true, id: params.id };
    },
  });
}
