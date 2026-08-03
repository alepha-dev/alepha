import { $inject, SchemaValidator } from "alepha";
import { $repository, type Page } from "alepha/orm";
import { type ProductEntity, products } from "../entities/products.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";

export interface CreateProduct {
  kind?: string;
  slug: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  categoryId?: string;
  /** File ids or URLs; the first is the listing image. */
  images?: string[];
  config?: Record<string, any>;
  /** Descriptive display attributes; not validated by the kind. */
  attributes?: Record<string, any>;
  published?: boolean;
}

export interface CatalogQuery {
  size?: number;
  page?: number;
  sort?: string;
  kind?: string;
}

/**
 * Reads and writes the catalog.
 *
 * The one rule it enforces: a product's `config` must satisfy the schema
 * declared by the handler that owns its `kind`. Validating on write is what
 * keeps `fulfil` free of defensive parsing — by the time a line is paid for,
 * its config has already been proven well-formed.
 */
export class CatalogService {
  protected readonly repo = $repository(products);
  protected readonly kinds = $inject(ProductKindRegistry);
  protected readonly validator = $inject(SchemaValidator);

  public async create(data: CreateProduct): Promise<ProductEntity> {
    const kind = data.kind ?? "good";
    return this.repo.create({
      ...data,
      kind,
      config: this.validateConfig(kind, data.config),
    });
  }

  public async update(
    id: string,
    data: Partial<CreateProduct>,
  ): Promise<ProductEntity> {
    const current = await this.repo.getById(id);
    const kind = data.kind ?? current.kind;
    // Re-validate against the (possibly new) kind: changing `kind` on an
    // existing row must not leave a config the new handler cannot read.
    const config =
      data.config !== undefined || data.kind !== undefined
        ? this.validateConfig(kind, data.config ?? current.config)
        : undefined;

    return this.repo.updateById(id, {
      ...data,
      kind,
      ...(config !== undefined ? { config } : {}),
    });
  }

  /**
   * Public catalog listing — published rows only.
   */
  public async list(query: CatalogQuery = {}): Promise<Page<ProductEntity>> {
    const where = this.repo.createQueryWhere();
    where.published = { eq: true };
    // Omit the key entirely when absent: a `where` value of `undefined` throws.
    if (query.kind) {
      where.kind = { eq: query.kind };
    }
    return this.repo.paginate({ sort: "name", ...query }, { where });
  }

  /**
   * Back-office listing: drafts included. Deliberately a separate method from
   * {@link list} rather than a `published?` filter — a public endpoint that
   * forgets to pass the filter would leak unfinished products, and an
   * easy-to-forget parameter is how that happens.
   */
  public async listAll(query: CatalogQuery = {}): Promise<Page<ProductEntity>> {
    const where = this.repo.createQueryWhere();
    if (query.kind) {
      where.kind = { eq: query.kind };
    }
    // `count: true` so a back office shows "6 of 6" rather than "6 of ?". The
    // public listing skips it deliberately: a storefront never renders a total,
    // and the extra COUNT(*) is pure cost there.
    return this.repo.paginate(
      { sort: "-createdAt", ...query },
      { where },
      { count: true },
    );
  }

  public async findBySlug(slug: string): Promise<ProductEntity | undefined> {
    return this.repo.findOne({ where: { slug: { eq: slug } } });
  }

  public async getById(id: string): Promise<ProductEntity> {
    return this.repo.getById(id);
  }

  public async publish(id: string, published = true): Promise<ProductEntity> {
    return this.repo.updateById(id, { published });
  }

  /**
   * Resolve the kind (throwing if no module owns it) and validate its config.
   */
  protected validateConfig(
    kind: string,
    config: unknown,
  ): Record<string, any> | undefined {
    const handler = this.kinds.get(kind);
    if (!handler.configSchema) {
      return config as Record<string, any> | undefined;
    }
    return this.validator.validate(
      handler.configSchema,
      config ?? {},
    ) as Record<string, any>;
  }
}
