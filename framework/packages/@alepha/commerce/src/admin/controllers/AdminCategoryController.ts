import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { categories } from "../../entities/categories.ts";
import { CategoryService } from "../../services/CategoryService.ts";

const categoryInputSchema = z.object({
  name: z.text({ minLength: 1, maxLength: 200 }),
  slug: z.text({ minLength: 1, maxLength: 200 }),
  parentId: z.uuid().optional(),
  description: z.text({ maxLength: 4000 }).optional(),
  position: z.integer().optional(),
  published: z.boolean().optional(),
});

/**
 * Category management.
 */
export class AdminCategoryController {
  protected readonly url = "/admin/commerce/categories";
  protected readonly group = "admin:commerce:categories";
  protected readonly categories = $inject(CategoryService);

  public readonly commerceAdminCategoryList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List every category, drafts included",
    schema: { response: z.array(categories.schema) },
    handler: async () => this.categories.listAll(),
  });

  public readonly commerceAdminCategoryCreate = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Create a category",
    schema: { body: categoryInputSchema, response: categories.schema },
    handler: async ({ body }) => this.categories.create(body),
  });

  public readonly commerceAdminCategoryUpdate = $action({
    method: "PUT",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Update a category",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: categoryInputSchema.partial(),
      response: categories.schema,
    },
    handler: async ({ params, body }) =>
      this.categories.update(params.id, body),
  });

  public readonly commerceAdminCategoryDelete = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Delete an empty category",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: async ({ params }) => {
      await this.categories.delete(params.id);
      return { deleted: true };
    },
  });
}
