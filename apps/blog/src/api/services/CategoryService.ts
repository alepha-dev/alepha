import { $repository } from "alepha/orm";
import {
  type CategoryEntity,
  categoryEntity,
} from "../entities/categoryEntity.ts";

export class CategoryService {
  protected readonly repo = $repository(categoryEntity);

  async findAll(): Promise<CategoryEntity[]> {
    return this.repo.findMany({
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  async findBySlug(slug: string): Promise<CategoryEntity | undefined> {
    return this.repo.findOne({ where: { slug: { eq: slug } } });
  }

  async create(data: {
    name: string;
    slug?: string;
    description?: string;
    color?: string;
  }): Promise<CategoryEntity> {
    const slug = data.slug || this.generateSlug(data.name);
    return this.repo.create({ ...data, slug }) as Promise<CategoryEntity>;
  }

  async update(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      color?: string;
    },
  ): Promise<CategoryEntity> {
    const updated = await this.repo.updateOne({ id: { eq: id } }, data);
    return updated as CategoryEntity;
  }

  async delete(id: string): Promise<void> {
    await this.repo.deleteMany({ id: { eq: id } });
  }

  protected generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
