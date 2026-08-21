import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { createOrganizationSchema } from "../schemas/createOrganizationSchema.ts";
import { organizationQuerySchema } from "../schemas/organizationQuerySchema.ts";
import { organizationResourceSchema } from "../schemas/organizationResourceSchema.ts";
import { updateOrganizationSchema } from "../schemas/updateOrganizationSchema.ts";
import { OrganizationService } from "../services/OrganizationService.ts";

export class AdminOrganizationController {
  protected readonly url = "/organizations";
  protected readonly group = "admin:organizations";
  protected readonly organizationService = $inject(OrganizationService);

  /**
   * Find organizations with pagination and filtering.
   */
  public readonly findOrganizations = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:organization:read"] })],
    description: "Find organizations with pagination and filtering",
    schema: {
      query: organizationQuerySchema,
      response: z.page(organizationResourceSchema),
    },
    handler: ({ query }) => this.organizationService.find(query),
  });

  /**
   * Get an organization by ID.
   */
  public readonly getOrganization = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:organization:read"] })],
    description: "Get an organization by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: organizationResourceSchema,
    },
    handler: ({ params }) => this.organizationService.getById(params.id),
  });

  /**
   * Create a new organization.
   */
  public readonly createOrganization = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:organization:create"] })],
    description: "Create a new organization",
    schema: {
      body: createOrganizationSchema,
      response: organizationResourceSchema,
    },
    handler: ({ body }) => this.organizationService.create(body),
  });

  /**
   * Update an organization.
   */
  public readonly updateOrganization = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:organization:update"] })],
    description: "Update an organization",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      body: updateOrganizationSchema,
      response: organizationResourceSchema,
    },
    handler: ({ params, body }) =>
      this.organizationService.update(params.id, body),
  });

  /**
   * Delete an organization.
   */
  public readonly deleteOrganization = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:organization:delete"] })],
    description: "Delete an organization",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.organizationService.delete(params.id);
      return { ok: true, id: params.id };
    },
  });
}
