import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import {
  type OrganizationEntity,
  organizations,
} from "../entities/organizations.ts";
import type { CreateOrganization } from "../schemas/createOrganizationSchema.ts";
import type { OrganizationQuery } from "../schemas/organizationQuerySchema.ts";
import type { UpdateOrganization } from "../schemas/updateOrganizationSchema.ts";

export class OrganizationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(organizations);

  /**
   * Find organizations with pagination and filtering.
   */
  public async find(
    query: OrganizationQuery = {},
  ): Promise<Page<OrganizationEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.name) {
      where.name = { like: `%${query.name}%` };
    }

    if (query.enabled !== undefined) {
      where.enabled = { eq: query.enabled };
    }

    return this.repo.paginate(query, { where }, { count: true });
  }

  /**
   * Get an organization by ID.
   */
  public async getById(id: string): Promise<OrganizationEntity> {
    return this.repo.getById(id);
  }

  /**
   * Get an organization by slug.
   */
  public async getBySlug(slug: string): Promise<OrganizationEntity> {
    return this.repo.getOne({ where: { slug: { eq: slug } } });
  }

  /**
   * Create a new organization.
   */
  public async create(data: CreateOrganization): Promise<OrganizationEntity> {
    return this.repo.create(data);
  }

  /**
   * Update an organization.
   */
  public async update(
    id: string,
    data: UpdateOrganization,
  ): Promise<OrganizationEntity> {
    return this.repo.updateById(id, data);
  }

  /**
   * Delete an organization.
   */
  public async delete(id: string): Promise<void> {
    await this.repo.deleteById(id);
  }
}
