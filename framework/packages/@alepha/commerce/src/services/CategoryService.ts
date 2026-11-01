import { $repository } from "alepha/orm";

import { type CategoryEntity, categories } from "../entities/categories.ts";
import { products } from "../entities/products.ts";
import { CategoryInUseError, CommerceError } from "../errors/CommerceError.ts";

export interface CategoryInput {
  name: string;
  slug: string;
  parentId?: string;
  description?: string;
  position?: number;
  published?: boolean;
}

/**
 * The catalogue's shelves.
 *
 * Read whole and walked in memory: a shop has dozens of categories, and a
 * recursive query per dialect would buy nothing at that size.
 */
export class CategoryService {
  protected readonly repo = $repository(categories);
  /**
   * Read-only, for {@link delete}'s guard.
   */
  protected readonly productRepo = $repository(products);

  public async create(data: CategoryInput): Promise<CategoryEntity> {
    return this.repo.create(data);
  }

  /**
   * @throws CommerceError when the new parent would make a loop
   */
  public async update(
    id: string,
    data: Partial<CategoryInput>,
  ): Promise<CategoryEntity> {
    if (
      data.parentId &&
      (await this.subtreeOf(id)).some((it) => it === data.parentId)
    ) {
      throw new CommerceError(`Category ${id} cannot go under itself.`);
    }
    return this.repo.updateById(id, data);
  }

  /**
   * Remove an empty category. One that still holds products or other
   * categories would leave them pointing at nothing.
   *
   * @throws CategoryInUseError
   */
  public async delete(id: string): Promise<void> {
    const children = await this.repo.count({ parentId: { eq: id } });
    const held = await this.productRepo.count({ categoryId: { eq: id } });
    if (children + held > 0) {
      throw new CategoryInUseError({ categoryId: id, held: children + held });
    }
    await this.repo.deleteById(id);
  }

  public async getById(id: string): Promise<CategoryEntity> {
    return this.repo.getById(id);
  }

  public async findBySlug(slug: string): Promise<CategoryEntity | undefined> {
    return this.repo.findOne({ where: { slug: { eq: slug } } });
  }

  /**
   * Every category, in the shop's order: drafts included, for the back office.
   */
  public async listAll(): Promise<CategoryEntity[]> {
    return this.repo.findMany({
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "name", direction: "asc" },
      ],
    });
  }

  /**
   * What a storefront shows. A separate method from {@link listAll} rather than
   * a flag, for the reason `CatalogService.listAll` is.
   */
  public async listPublished(): Promise<CategoryEntity[]> {
    return (await this.listAll()).filter((it) => it.published);
  }

  /**
   * A category and everything under it.
   */
  public async subtreeOf(id: string): Promise<string[]> {
    const all = await this.repo.findMany({ columns: ["id", "parentId"] });
    const found = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const category of all) {
        if (
          category.parentId &&
          found.has(category.parentId) &&
          !found.has(category.id)
        ) {
          found.add(category.id);
          grew = true;
        }
      }
    }
    return [...found];
  }
}
