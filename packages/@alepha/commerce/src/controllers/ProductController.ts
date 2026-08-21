import { $inject, type Infer, z } from "alepha";
import { db } from "alepha/orm";
import { $action, NotFoundError } from "alepha/server";

import type { ProductEntity } from "../entities/products.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * A product as a storefront needs it.
 *
 * Spelled out rather than `products.schema.extend({ available })`, for two
 * reasons. The extend broke at runtime — the response encoder rejected every
 * payload with `'slug' is required at /slug` — because extending a schema whose
 * fields carry ORM attributes does not survive the round trip. And the entity
 * schema is the wrong contract for a public endpoint anyway: it would have
 * shipped `organizationId` and the row version to anyone who asked.
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
      // Availability per row, so a listing can grey out what is gone without a
      // second request per product.
      const content = await Promise.all(
        page.content.map(async (product) => ({
          ...this.publicView(product),
          available: await this.stock.available(product.id),
        })),
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
      return {
        ...this.publicView(product),
        available: await this.stock.available(product.id),
      };
    },
  });

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
    };
  }
}
