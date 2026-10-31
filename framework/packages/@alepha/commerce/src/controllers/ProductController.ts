import { $inject, type Infer, z } from "alepha";
import { db } from "alepha/orm";
import { $action, NotFoundError } from "alepha/server";

import type { ProductEntity } from "../entities/products.ts";
import type { ProductVariantEntity } from "../entities/productVariants.ts";
import { optionGroupSchema } from "../schemas/optionGroupSchema.ts";
import { publicVariantSchema } from "../schemas/publicVariantSchema.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";

/**
 * A product as a storefront needs it.
 *
 * Spelled out rather than `products.schema.extend({ available })`: the entity
 * schema is the wrong contract for a public endpoint, it would ship the row
 * version to anyone who asked. (The admin controller does extend it, for an
 * audience that may see that.)
 *
 * `available` and not `onHand`: what is in the drawer is nobody's business, and
 * quoting it would promise units already in someone else's checkout.
 */
export const publicProductSchema = z.object({
  id: z.uuid(),
  kind: z.text(),
  slug: z.text(),
  name: z.text(),
  description: z.text().optional(),
  price: z.integer(),
  currency: z.text(),
  images: z.array(z.text()),
  attributes: z.record(z.text(), z.any()).optional(),
  available: z.integer(),
  optionGroups: z.array(optionGroupSchema),
  /**
   * The lowest price on sale, on a product whose variants differ: what a
   * listing says after "from".
   */
  priceFrom: z.integer().optional(),
  /**
   * On the detail only: a listing draws no picker.
   */
  variants: z.array(publicVariantSchema).optional(),
});

export type PublicProduct = Infer<typeof publicProductSchema>;

/**
 * Public catalog. No authentication — a storefront is readable by anyone, and
 * only published rows are ever returned.
 */
export class ProductController {
  protected readonly url = "/commerce/products";
  protected readonly group = "commerce:catalog";
  protected readonly catalog = $inject(CatalogService);
  protected readonly stock = $inject(StockService);
  protected readonly variants = $inject(VariantService);

  public readonly commerceProductList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    description: "List published products",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
        kind: z.text({ maxLength: 64 }).optional(),
      }),
      response: db.page(publicProductSchema),
    },
    handler: async ({ query }) => {
      const page = await this.catalog.list(query);
      const variants = await this.variants.listForProducts(
        page.content.map((product) => product.id),
      );
      // Availability per row, so a listing can grey out what is gone without a
      // second request per product.
      const content = await Promise.all(
        page.content.map(async (product) => {
          const onSale = this.onSale(product, variants);
          const { priceFrom, available } = await this.figures(product, onSale);
          return { ...this.publicView(product), priceFrom, available };
        }),
      );
      return { ...page, content };
    },
  });

  public readonly commerceProductGetBySlug = $action({
    method: "GET",
    path: `${this.url}/:slug`,
    group: this.group,
    description: "Get a published product by slug, with its availability",
    schema: {
      params: z.object({ slug: z.text({ minLength: 1, maxLength: 200 }) }),
      response: publicProductSchema,
    },
    handler: async ({ params }) => {
      const product = await this.catalog.findBySlug(params.slug);
      if (!product?.published) {
        throw new NotFoundError(`No such product: ${params.slug}`);
      }
      const onSale = this.onSale(
        product,
        await this.variants.listOf(product.id),
      );
      const { priceFrom, available, perVariant } = await this.figures(
        product,
        onSale,
      );
      return {
        ...this.publicView(product),
        priceFrom,
        available,
        variants: onSale.length > 0 ? perVariant : undefined,
      };
    },
  });

  /**
   * The variants of a product a buyer can pick.
   */
  protected onSale(
    product: ProductEntity,
    variants: ProductVariantEntity[],
  ): ProductVariantEntity[] {
    return variants.filter((it) => it.productId === product.id && it.active);
  }

  /**
   * What the catalogue says about a product's stock and price. With variants,
   * availability is the sum of those on sale: stock under a variant nobody can
   * pick cannot be sold.
   */
  protected async figures(
    product: ProductEntity,
    onSale: ProductVariantEntity[],
  ) {
    if (onSale.length === 0) {
      return {
        priceFrom: undefined,
        available: await this.stock.available(product.id),
        perVariant: [],
      };
    }

    const perVariant = await Promise.all(
      onSale.map(async (variant) => ({
        id: variant.id,
        options: variant.options as Record<string, string>,
        price: variant.price ?? product.price,
        image: variant.image,
        available: await this.stock.available(product.id, variant.id),
      })),
    );
    const prices = perVariant.map((it) => it.price);
    return {
      priceFrom: new Set(prices).size > 1 ? Math.min(...prices) : undefined,
      available: perVariant.reduce((sum, it) => sum + it.available, 0),
      perVariant,
    };
  }

  /**
   * Narrow a catalog row to what a storefront may see. One place, so a new
   * internal column cannot leak by being forgotten here.
   */
  protected publicView(product: ProductEntity) {
    return {
      id: product.id,
      kind: product.kind,
      slug: product.slug,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      images: product.images,
      attributes: product.attributes,
      optionGroups: product.optionGroups,
    };
  }
}
