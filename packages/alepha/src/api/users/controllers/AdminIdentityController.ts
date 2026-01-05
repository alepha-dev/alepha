import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import { identityQuerySchema } from "../schemas/identityQuerySchema.ts";
import { identityResourceSchema } from "../schemas/identityResourceSchema.ts";
import { IdentityService } from "../services/IdentityService.ts";

export class AdminIdentityController {
  protected readonly url = "/identities";
  protected readonly group = "admin:identities";
  protected readonly identityService = $inject(IdentityService);

  /**
   * Find identities with pagination and filtering.
   */
  public readonly findIdentities = $action({
    path: this.url,
    group: this.group,
    description: "Find identities with pagination and filtering",
    schema: {
      query: t.extend(identityQuerySchema, {
        userRealmName: t.optional(t.string()),
      }),
      response: t.page(identityResourceSchema),
    },
    handler: ({ query }) => {
      const { userRealmName, ...q } = query;
      return this.identityService.findIdentities(q, userRealmName);
    },
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: identityResourceSchema,
    },
    handler: ({ params, query }) =>
      this.identityService.getIdentityById(params.id, query.userRealmName),
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.identityService.deleteIdentity(params.id, query.userRealmName);
      return { ok: true, id: params.id };
    },
  });
}
