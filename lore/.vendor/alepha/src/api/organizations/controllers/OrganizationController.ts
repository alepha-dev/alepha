import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { organizations } from "../entities/organizations.ts";
import { createOrganizationSchema } from "../schemas/createOrganizationSchema.ts";
import { organizationSummaryResourceSchema } from "../schemas/organizationSummaryResourceSchema.ts";
import { updateOrganizationSchema } from "../schemas/updateOrganizationSchema.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { OrganizationService } from "../services/OrganizationService.ts";

export class OrganizationController {
  protected readonly organizations = $inject(OrganizationService);

  public readonly getMyOrganizations = $action({
    path: "/organizations",
    use: [$secure()],
    schema: { response: z.array(organizationSummaryResourceSchema) },
    handler: ({ user }) => this.organizations.listMine(user.id),
  });

  public readonly createOrganization = $action({
    method: "POST",
    path: "/organizations",
    use: [$secure()],
    schema: { body: createOrganizationSchema, response: organizations.schema },
    handler: ({ body, user }) => this.organizations.create(body, user),
  });

  public readonly getOrganization = $action({
    path: "/organizations/:organizationId",
    use: [$ownsOrganization({ param: "organizationId" })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: organizations.schema,
    },
    handler: ({ params }) => this.organizations.get(params.organizationId),
  });

  public readonly updateOrganization = $action({
    method: "PUT",
    path: "/organizations/:organizationId",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "organization:update",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: updateOrganizationSchema,
      response: organizations.schema,
    },
    handler: ({ params, body }) =>
      this.organizations.update(params.organizationId, body),
  });

  public readonly deleteOrganization = $action({
    method: "DELETE",
    path: "/organizations/:organizationId",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "organization:delete",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.organizations.delete(params.organizationId, user);
      return { ok: true };
    },
  });
}
