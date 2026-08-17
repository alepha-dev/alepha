import { $inject, AlephaError, SchemaValidator } from "alepha";
import { $repository, type Page } from "alepha/orm";
import { orderItems } from "../entities/orderItems.ts";
import { type ProductEntity, products } from "../entities/products.ts";
import { ProductHasOrdersError } from "../errors/CommerceError.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";

export interface CreateProduct {
  kind?: string;
  slug: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  categoryId?: string;
  /** VAT rate in basis points; omit to bill at the seller's default rate. */
  vatRateBps?: number;
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
  /**
   * Read-only, and only for {@link delete}'s guard — whether a product may be
   * removed is a catalogue rule that only the order history can answer.
   */
  protected readonly orderItemRepo = $repository(orderItems);
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
   * Create a placeholder product and hand it back, so the back office can send
   * the operator straight to its detail page to fill in.
   *
   * There is no create *form*: a product has too many fields to ask for up
   * front, and the ones that matter (price, images, tax rate) are decided while
   * looking at the thing. So a draft is born unpublished, at zero, named after
   * its own slug, and nothing about it is visible to a buyer until someone
   * publishes it.
   *
   * The slug walks forward from the current row count rather than from 1, so a
   * catalogue of 200 does not probe 200 taken slugs to find a free one. Two
   * operators clicking at once still collide — `(organizationId, slug)` is
   * unique — which is why a failed insert re-checks and moves on rather than
   * surfacing a constraint error to whoever clicked second.
   */
  public async createDraft(): Promise<ProductEntity> {
    const kind = this.draftKind();
    let n = (await this.repo.count()) + 1;

    for (let attempt = 0; attempt < 50; attempt++, n++) {
      const slug = `product-${n}`;
      if (await this.findBySlug(slug)) continue;
      try {
        return await this.create({
          slug,
          name: slug,
          price: 0,
          kind,
          published: false,
        });
      } catch (error) {
        // Only a lost race for this slug is retryable. Anything else — a kind
        // with a config schema that rejects `{}`, a database that is down — is
        // the caller's problem and must not be swallowed 50 times over.
        if (!(await this.findBySlug(slug))) throw error;
      }
    }

    throw new AlephaError(
      "Could not allocate a slug for a new draft product after 50 attempts.",
    );
  }

  /**
   * Remove a product from the catalogue for good.
   *
   * Refuses while any order line still points at it. Deleting anyway would be
   * safe for the *order* — `orderItems` snapshots name, price and kind, and
   * holds `productId` as a plain uuid precisely so nothing cascades — but it
   * would strip the catalogue row an operator needs to answer "what is this
   * line on the invoice", and there is no undo. Unpublishing hides a product
   * from buyers and keeps the history readable, which is what someone reaching
   * for delete on a product that has sold actually wants.
   *
   * The check lives here rather than in the controller so no future caller can
   * forget it. That is why this service knows about `orderItems` at all —
   * whether a product may be deleted is a catalogue rule that only the order
   * history can answer.
   */
  public async delete(id: string): Promise<void> {
    const sold = await this.orderItemRepo.count({ productId: { eq: id } });
    if (sold > 0) {
      throw new ProductHasOrdersError(id, sold);
    }
    await this.repo.deleteById(id);
  }

  /**
   * Which kind a brand-new draft should be.
   *
   * Not simply the first registered kind: kinds are ordered arbitrarily, and
   * the first one may declare a config schema with required fields. Core's
   * `digital` requires a `downloadUrl`, so "first registered" made
   * {@link createDraft} fail outright on any application that registers it —
   * the button did nothing and answered 400.
   *
   * `good` first, because it is `products.kind`'s own default and needs no
   * configuration. Failing that, the first kind that can be created with an
   * empty config — a draft has nobody to ask for a download URL yet, and the
   * operator picks the real kind on the detail page a moment later.
   */
  protected draftKind(): string {
    const known = this.kinds.kinds();
    if (known.includes("good")) return "good";

    for (const kind of known) {
      const schema = this.kinds.get(kind).configSchema;
      if (!schema) return kind;
      try {
        this.validator.validate(schema, {});
        return kind;
      } catch {
        // Requires configuration a draft cannot supply; try the next.
      }
    }

    throw new AlephaError(
      `Cannot create a draft product: every registered kind (${
        known.join(", ") || "none"
      }) requires configuration. Register a kind whose config schema accepts an empty object.`,
    );
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
