import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { categoryResourceSchema } from "../schemas/categorySchemas.ts";
import { CategoryService } from "../services/CategoryService.ts";

/**
 * Public category endpoints.
 */
export class CategoryController {
  protected readonly group = "categories";
  protected readonly categoryService = $inject(CategoryService);

  /**
   * GET /categories - List all categories.
   */
  public readonly listCategories = $action({
    path: "/categories",
    group: this.group,
    description: "List all blog categories",
    schema: {
      response: t.array(categoryResourceSchema),
    },
    handler: () => this.categoryService.findAll() as any,
  });
}
