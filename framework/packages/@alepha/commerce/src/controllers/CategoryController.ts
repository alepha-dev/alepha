import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import type { CategoryEntity } from "../entities/categories.ts";
import { publicCategorySchema } from "../schemas/publicCategorySchema.ts";
import { CategoryService } from "../services/CategoryService.ts";

/**
 * The catalogue's shelves, for a storefront's navigation. Public, like the
 * products on them.
 */
export class CategoryController {
  protected readonly url = "/commerce/categories";
  protected readonly group = "commerce:catalog";
  protected readonly categories = $inject(CategoryService);

  public readonly commerceCategoryList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    description: "List published categories, in the shop's order",
    schema: { response: z.array(publicCategorySchema) },
    handler: async () =>
      (await this.categories.listPublished()).map((category) =>
        this.publicView(category),
      ),
  });

  /**
   * Narrow a row to what a storefront may see.
   */
  protected publicView(category: CategoryEntity) {
    return {
      id: category.id,
      parentId: category.parentId,
      slug: category.slug,
      name: category.name,
      description: category.description,
    };
  }
}
