import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import {
  categoryCreateSchema,
  categoryResourceSchema,
  categoryUpdateSchema,
} from "../schemas/categorySchemas.ts";
import { CategoryService } from "../services/CategoryService.ts";

/**
 * Admin category management endpoints.
 */
export class AdminCategoryController {
  protected readonly url = "/admin/categories";
  protected readonly group = "admin:categories";
  protected readonly categoryService = $inject(CategoryService);

  /**
   * POST /admin/categories - Create a category.
   */
  public readonly createCategory = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    description: "Create a blog category",
    schema: {
      body: categoryCreateSchema,
      response: categoryResourceSchema,
    },
    handler: ({ body }) => this.categoryService.create(body) as any,
  });

  /**
   * PATCH /admin/categories/:id - Update a category.
   */
  public readonly updateCategory = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Update a blog category",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: categoryUpdateSchema,
      response: categoryResourceSchema,
    },
    handler: ({ params, body }) =>
      this.categoryService.update(params.id, body) as any,
  });

  /**
   * DELETE /admin/categories/:id - Delete a category.
   */
  public readonly deleteCategory = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete a blog category",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.categoryService.delete(params.id);
      return { ok: true as const };
    },
  });
}
