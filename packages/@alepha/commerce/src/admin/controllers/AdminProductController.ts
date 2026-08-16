import { $inject, type Infer, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { products } from "../../entities/products.ts";
import { ProductKindRegistry } from "../../providers/ProductKindRegistry.ts";
import { CatalogService } from "../../services/CatalogService.ts";
import { StockService } from "../../services/StockService.ts";

/** A catalog row with its live stock figures, which is what an admin needs. */
export const adminProductSchema = products.schema.extend({
  onHand: z.integer(),
  reserved: z.integer(),
  available: z.integer(),
});

export type AdminProductResource = Infer<typeof adminProductSchema>;

const productInputSchema = z.object({
  kind: z.text({ maxLength: 64 }).optional(),
  slug: z.text({ minLength: 1, maxLength: 200 }),
  name: z.text({ minLength: 1, maxLength: 200 }),
  description: z.text({ maxLength: 4000 }).optional(),
  price: z.integer().min(0),
  currency: z.text({ minLength: 3, maxLength: 3 }).optional(),
  images: z.array(z.text({ maxLength: 500 })).optional(),
  config: z.record(z.text(), z.any()).optional(),
  attributes: z.record(z.text(), z.any()).optional(),
  published: z.boolean().optional(),
});

/**
 * Catalog management.
 *
 * Reads carry stock figures the public catalog has no business exposing —
 * on-hand, reserved, available — because deciding what to restock is the reason
 * anyone opens this screen.
 */
export class AdminProductController {
  protected readonly url = "/admin/commerce/products";
  protected readonly group = "admin:commerce:products";
  protected readonly catalog = $inject(CatalogService);
  protected readonly stock = $inject(StockService);
  protected readonly kinds = $inject(ProductKindRegistry);

  public readonly commerceAdminProductList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List every product, draft included, with stock figures",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
        sort: z.text({ maxLength: 40 }).optional(),
        /*
         * The catalogue's Type filter.
         *
         * `CatalogService.listAll` has always honoured `query.kind` — it was
         * only missing from this schema, and an undeclared query param is
         * stripped before the handler sees it. So the filter sent
         * `?kind=engraved`, got a 200, and the table came back unfiltered:
         * the one failure shape that looks like the feature working.
         */
        kind: z.text({ maxLength: 64 }).optional(),
      }),
      response: db.page(adminProductSchema),
    },
    handler: async ({ query }) => {
      const page = await this.catalog.listAll(query);
      const withStock = await Promise.all(
        page.content.map(async (product) => ({
          ...product,
          onHand: await this.stock.onHand(product.id),
          reserved: await this.stock.reserved(product.id),
          available: await this.stock.available(product.id),
        })),
      );
      return { ...page, content: withStock };
    },
  });

  /**
   * The kinds this deployment understands — what a product form's picker offers.
   * Reading it from the registry rather than hard-coding a list is what lets an
   * application's own kind appear here without touching this package.
   */
  /*
   * No `name:` override.
   *
   * It used to register as `commerceAdminProductKindList` while the property
   * — which is what `$client<AdminProductController>()` dispatches on — stayed
   * `commerceAdminProductKinds`, so every caller resolved a name the registry
   * did not have and got "Action commerceAdminProductKinds not found" at
   * runtime. Typecheck cannot see it: the proxy is typed from the class, so
   * the property exists and only the registered name is wrong.
   *
   * The effect was silent rather than loud — `kinds` stayed undefined, and
   * both the catalogue's Type filter and the editor's kind picker rendered
   * with no options at all rather than failing. It was the only `name:`
   * override in this controller, and nothing anywhere referenced the name it
   * introduced.
   */
  public readonly commerceAdminProductKinds = $action({
    method: "GET",
    path: `${this.url}/kinds`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List registered product kinds",
    schema: { response: z.object({ kinds: z.array(z.text()) }) },
    handler: async () => ({ kinds: this.kinds.kinds() }),
  });

  public readonly commerceAdminProductCreate = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Create a product",
    schema: { body: productInputSchema, response: products.schema },
    handler: async ({ body }) => this.catalog.create(body),
  });

  public readonly commerceAdminProductUpdate = $action({
    method: "PUT",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Update a product",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: productInputSchema.partial(),
      response: products.schema,
    },
    handler: async ({ params, body }) => this.catalog.update(params.id, body),
  });

  /**
   * Put a piece on sale, or take it off.
   *
   * Its own endpoint rather than a field on `update`, because it is the action an
   * operator takes most often and the one they want to be able to undo in a
   * single click. A PUT carrying the whole product to flip one boolean also risks
   * clobbering a concurrent edit.
   */
  public readonly commerceAdminProductPublish = $action({
    method: "POST",
    path: `${this.url}/:id/publish`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Publish or unpublish a product",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ published: z.boolean() }),
      response: products.schema,
    },
    handler: async ({ params, body }) =>
      this.catalog.publish(params.id, body.published),
  });

  public readonly commerceAdminProductRestock = $action({
    method: "POST",
    path: `${this.url}/:id/stock`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Record a stock intake",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        quantity: z.integer().min(1).max(100000),
        note: z.text({ maxLength: 500 }).optional(),
      }),
      response: z.object({ onHand: z.integer() }),
    },
    handler: async ({ params, body }) => {
      await this.stock.recordIntake(params.id, body.quantity, {
        note: body.note,
      });
      return { onHand: await this.stock.onHand(params.id) };
    },
  });
}
