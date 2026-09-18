import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { organizations } from "../entities/organizations.ts";
import { updateOrganizationSchema } from "../schemas/updateOrganizationSchema.ts";
import { OrganizationService } from "../services/OrganizationService.ts";

export class AdminOrganizationController {
  protected readonly repository = $repository(organizations);
  protected readonly service = $inject(OrganizationService);

  public readonly getAdminOrganizations = $action({
    path: "/admin/organizations",
    use: [$secure({ permissions: ["admin:organization:read"] })],
    schema: { response: z.array(organizations.schema) },
    handler: () => this.repository.findMany(),
  });

  public readonly getAdminOrganization = $action({
    path: "/admin/organizations/:organizationId",
    use: [$secure({ permissions: ["admin:organization:read"] })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: organizations.schema,
    },
    handler: ({ params }) => this.service.get(params.organizationId),
  });

  public readonly updateAdminOrganization = $action({
    method: "PUT",
    path: "/admin/organizations/:organizationId",
    use: [$secure({ permissions: ["admin:organization:update"] })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: updateOrganizationSchema,
      response: organizations.schema,
    },
    handler: ({ params, body }) =>
      this.service.update(params.organizationId, body),
  });

  public readonly deleteAdminOrganization = $action({
    method: "DELETE",
    path: "/admin/organizations/:organizationId",
    use: [$secure({ permissions: ["admin:organization:delete"] })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.repository.deleteById(params.organizationId);
      return { ok: true };
    },
  });
}
