import { $inject, z } from "alepha";
import { $secure, SecurityProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { identityQuerySchema } from "../schemas/identityQuerySchema.ts";
import { identityResourceSchema } from "../schemas/identityResourceSchema.ts";
import { IdentityService } from "../services/IdentityService.ts";

export class AdminIdentityController {
  protected readonly url = "/identities";
  protected readonly group = "admin:identities";
  protected readonly identityService = $inject(IdentityService);
  protected readonly securityProvider = $inject(SecurityProvider);

  /**
   * Find identities with pagination and filtering.
   */
  public readonly findIdentities = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:identity:read"] })],
    description: "Find identities with pagination and filtering",
    schema: {
      query: identityQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(identityResourceSchema),
    },
    handler: ({ query, user }) => {
      const { userRealmName, ...q } = query;
      return this.identityService.findIdentities(
        q,
        this.securityProvider.assertRealmScope(user, userRealmName),
      );
    },
  });

  /**
   * Get an identity by ID.
   */
  public readonly getIdentity = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:identity:read"] })],
    description: "Get an identity by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: identityResourceSchema,
    },
    handler: ({ params, query, user }) =>
      this.identityService.getIdentityById(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      ),
  });

  /**
   * Delete an identity.
   */
  public readonly deleteIdentity = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:identity:delete"] })],
    description: "Delete an identity",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.identityService.deleteIdentity(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return { ok: true, id: params.id };
    },
  });
}
