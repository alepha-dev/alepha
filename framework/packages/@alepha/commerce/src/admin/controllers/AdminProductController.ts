import { $inject, type Infer, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { orderItems } from "../../entities/orderItems.ts";
import { productPrices } from "../../entities/productPrices.ts";
import { products } from "../../entities/products.ts";
import {
  type ProductVariantEntity,
  productVariants,
} from "../../entities/productVariants.ts";
import { stockMovements } from "../../entities/stockMovements.ts";
import { ProductKindRegistry } from "../../providers/ProductKindRegistry.ts";
import { optionGroupSchema } from "../../schemas/optionGroupSchema.ts";
import { CatalogService } from "../../services/CatalogService.ts";
import { OrderService } from "../../services/OrderService.ts";
import { PriceListService } from "../../services/PriceListService.ts";
import { StockService } from "../../services/StockService.ts";
import { VariantService } from "../../services/VariantService.ts";

/**
 * A catalog row with its live stock figures, which is what an admin needs.
 */
export const adminProductSchema = products.schema.extend({
  onHand: z.integer(),
  reserved: z.integer(),
  available: z.integer(),
  /**
   * How many variants the product sells through. Above zero, a stock movement
   * has to name one.
   */
  variantCount: z.integer(),
});

export type AdminProductResource = Infer<typeof adminProductSchema>;

/**
 * A variant with its live stock figures.
 */
export const adminVariantSchema = productVariants.schema.extend({
  onHand: z.integer(),
  reserved: z.integer(),
  available: z.integer(),
});

export type AdminVariantResource = Infer<typeof adminVariantSchema>;

const variantInputSchema = z.object({
  sku: z.text({ minLength: 1, maxLength: 64 }),
  options: z.record(z.text(), z.text()),
  price: z.integer().min(0).optional(),
  compareAtPrice: z.integer().min(0).optional(),
  image: z.text({ maxLength: 500 }).optional(),
  weightGrams: z.integer().min(0).optional(),
  position: z.integer().optional(),
  active: z.boolean().optional(),
});

const productInputSchema = z.object({
  kind: z.text({ maxLength: 64 }).optional(),
  slug: z.text({ minLength: 1, maxLength: 200 }),
  name: z.text({ minLength: 1, maxLength: 200 }),
  description: z.text({ maxLength: 4000 }).optional(),
  categoryId: z.uuid().optional(),
  price: z.integer().min(0),
  currency: z.text({ minLength: 3, maxLength: 3 }).optional(),
  compareAtPrice: z.integer().min(0).optional(),
  metaTitle: z.text({ maxLength: 200 }).optional(),
  metaDescription: z.text({ maxLength: 500 }).optional(),
  weightGrams: z.integer().min(0).optional(),
  lengthMm: z.integer().min(0).optional(),
  widthMm: z.integer().min(0).optional(),
  heightMm: z.integer().min(0).optional(),
  /*
   * VAT rate in basis points.
   *
   * It was missing here while `products.vatRateBps` and
   * `CatalogService.CreateProduct` both had it, so the column the entity
   * documents as the whole reason a mixed-rate catalogue works could not be set
   * through the API at all - an undeclared body field is stripped before the
   * handler sees it. Every product billed at the seller's default rate, and the
   * per-rate breakdown invoicing promises could never have more than one line.
   */
  vatRateBps: z.integer().min(0).max(10000).optional(),
  optionGroups: z.array(optionGroupSchema).optional(),
  images: z.array(z.text({ maxLength: 500 })).optional(),
  config: z.record(z.text(), z.any()).optional(),
  attributes: z.record(z.text(), z.any()).optional(),
  published: z.boolean().optional(),
});

/**
 * `null` clears what an update would otherwise leave alone: a sale ends by
 * taking the compare-at price off.
 */
const productUpdateSchema = productInputSchema.partial().extend({
  compareAtPrice: z.integer().min(0).nullable().optional(),
  metaTitle: z.text({ maxLength: 200 }).nullable().optional(),
  metaDescription: z.text({ maxLength: 500 }).nullable().optional(),
  weightGrams: z.integer().min(0).nullable().optional(),
  lengthMm: z.integer().min(0).nullable().optional(),
  widthMm: z.integer().min(0).nullable().optional(),
  heightMm: z.integer().min(0).nullable().optional(),
});

const priceInputSchema = z.object({
  currency: z.text({ minLength: 3, maxLength: 3 }),
  price: z.integer().min(0),
  variantId: z.uuid().optional(),
});

/**
 * An order line as the catalogue shows it: the line, plus its order's context.
 */
export const productOrderLineSchema = orderItems.schema.extend({
  orderNumber: z.text().optional(),
  orderStatus: z.text().optional(),
  orderCreatedAt: z.text().optional(),
  orderCurrency: z.text().optional(),
});

/**
 * What the Orders tab renders. Inferred from the response schema rather than
 * reusing `OrderService.ProductOrderLine`: the status crosses the wire as plain
 * text, so the service's enum type would promise the client a narrowing the
 * payload does not carry.
 */
export type AdminProductOrderLine = Infer<typeof productOrderLineSchema>;

/**
 * Catalog management.
 *
 * Reads carry stock figures the public catalog has no business exposing -
 * on-hand, reserved, available - because deciding what to restock is the reason
 * anyone opens this screen.
 */
export class AdminProductController {
  protected readonly url = "/admin/commerce/products";
  protected readonly group = "admin:commerce:products";
  protected readonly catalog = $inject(CatalogService);
  protected readonly stock = $inject(StockService);
  protected readonly orders = $inject(OrderService);
  protected readonly kinds = $inject(ProductKindRegistry);
  protected readonly variants = $inject(VariantService);
  protected readonly prices = $inject(PriceListService);

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
         * `CatalogService.listAll` has always honoured `query.kind` - it was
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
      const ids = page.content.map((product) => product.id);
      const variants = await this.variants.listForProducts(ids);
      const stock = await this.stock.figuresFor(ids);
      const withStock = page.content.map((product) => ({
        ...product,
        ...stock.of(product.id),
        variantCount: variants.filter((it) => it.productId === product.id)
          .length,
      }));
      return { ...page, content: withStock };
    },
  });

  /**
   * The kinds this deployment understands - what a product form's picker offers.
   * Reading it from the registry rather than hard-coding a list is what lets an
   * application's own kind appear here without touching this package.
   */
  /*
   * No `name:` override.
   *
   * It used to register as `commerceAdminProductKindList` while the property
   * - which is what `$client<AdminProductController>()` dispatches on - stayed
   * `commerceAdminProductKinds`, so every caller resolved a name the registry
   * did not have and got "Action commerceAdminProductKinds not found" at
   * runtime. Typecheck cannot see it: the proxy is typed from the class, so
   * the property exists and only the registered name is wrong.
   *
   * The effect was silent rather than loud - `kinds` stayed undefined, and
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
    description: "List registered product kinds and their config schemas",
    /*
     * `schemas` is *added* beside `kinds` rather than replacing it with a
     * richer array. The list filter and the editor's kind picker both read
     * `kinds`, as may a vendored consumer - and a response-shape change is
     * invisible to them until it 404s a form at runtime.
     *
     * A kind whose handler declares no `configSchema` is simply absent from
     * `schemas`, which is what tells the UI not to offer a config form at all.
     */
    schema: {
      response: z.object({
        kinds: z.array(z.text()),
        schemas: z.record(z.text(), z.record(z.text(), z.any())),
      }),
    },
    handler: async () => {
      const schemas: Record<string, any> = {};
      for (const kind of this.kinds.kinds()) {
        const configSchema = this.kinds.get(kind).configSchema;
        if (configSchema) {
          // The same round-trip `api/parameters` and `api/analytics` use:
          // JSON Schema on the wire, rebuilt client-side with `jsonSchemaToZod`
          // and handed to `AutoForm`. A zod schema cannot be serialised.
          schemas[kind] = z.toJSONSchema(configSchema as any);
        }
      }
      return { kinds: this.kinds.kinds(), schemas } as any;
    },
  });

  /**
   * One product with its stock figures - what the detail page loads.
   *
   * The list endpoint could not serve this: it pages, so a product on page 4 is
   * not reachable by id, and a detail page that had to scan pages to find its
   * own row would be absurd.
   */
  public readonly commerceAdminProductGet = $action({
    method: "GET",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "Get one product with its stock figures",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: adminProductSchema,
    },
    handler: async ({ params }) => {
      const product = await this.catalog.getById(params.id);
      const stock = await this.stock.figuresFor([product.id]);
      return {
        ...product,
        ...stock.of(product.id),
        variantCount: (await this.variants.listOf(product.id)).length,
      };
    },
  });

  /**
   * Create a placeholder and return it, so the back office can route straight
   * to its detail page.
   *
   * Takes no body on purpose: this is the "New product" button, and everything
   * a product needs is decided on the page that opens next. See
   * `CatalogService.createDraft`.
   */
  public readonly commerceAdminProductDraft = $action({
    method: "POST",
    path: `${this.url}/draft`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Create an empty draft product",
    schema: { response: products.schema },
    handler: async () => this.catalog.createDraft(),
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
      body: productUpdateSchema,
      response: products.schema,
    },
    handler: async ({ params, body }) => this.catalog.update(params.id, body),
  });

  /**
   * Put a product on sale, or take it off.
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
        variantId: z.uuid().optional(),
      }),
      response: z.object({ onHand: z.integer() }),
    },
    handler: async ({ params, body }) => {
      const variantId = await this.stockTarget(params.id, body.variantId);
      await this.stock.recordIntake(params.id, body.quantity, {
        note: body.note,
        variantId,
      });
      return { onHand: await this.stock.onHand(params.id, variantId) };
    },
  });

  /**
   * Correct the count in either direction, with a reason and a note.
   *
   * Kept apart from {@link commerceAdminProductRestock} rather than
   * generalising it, because they are two different affordances over the same
   * ledger: restock is the list's one-click `+1` for the common case, this is
   * the detail page's form for a real correction. Folding them together would
   * force a dialog that asks for a number onto the one-click path.
   */
  public readonly commerceAdminProductAdjustStock = $action({
    method: "POST",
    path: `${this.url}/:id/stock/adjust`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Adjust stock up or down, with a reason",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        /**
         * Signed, and refused at zero - see `StockService.recordAdjustment`.
         */
        quantity: z.integer().min(-100000).max(100000),
        reason: z.enum(["intake", "return", "adjustment"]),
        note: z.text({ maxLength: 500 }).optional(),
        variantId: z.uuid().optional(),
      }),
      response: z.object({
        onHand: z.integer(),
        reserved: z.integer(),
        available: z.integer(),
      }),
    },
    handler: async ({ params, body }) => {
      const variantId = await this.stockTarget(params.id, body.variantId);
      // An intake and a return are additions the ledger reports separately; an
      // adjustment is the only one that may go down.
      if (body.reason === "adjustment") {
        await this.stock.recordAdjustment(params.id, body.quantity, {
          note: body.note,
          variantId,
        });
      } else {
        await this.stock.recordIntake(params.id, Math.abs(body.quantity), {
          reason: body.reason,
          note: body.note,
          variantId,
        });
      }
      return {
        onHand: await this.stock.onHand(params.id, variantId),
        reserved: await this.stock.reserved(params.id, variantId),
        available: await this.stock.available(params.id, variantId),
      };
    },
  });

  /**
   * A product's prices in other currencies, and what it may be priced in.
   */
  public readonly commerceAdminProductPrices = $action({
    method: "GET",
    path: `${this.url}/:id/prices`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List a product's prices in other currencies",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        currencies: z.array(z.text()),
        prices: z.array(productPrices.schema),
      }),
    },
    handler: async ({ params }) => ({
      currencies: this.prices.currencies,
      prices: await this.prices.listOf(params.id),
    }),
  });

  public readonly commerceAdminProductPriceSet = $action({
    method: "PUT",
    path: `${this.url}/:id/prices`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Set a product's or a variant's price in a currency",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: priceInputSchema,
      response: productPrices.schema,
    },
    handler: async ({ params, body }) =>
      this.prices.set(await this.catalog.getById(params.id), body),
  });

  public readonly commerceAdminProductPriceRemove = $action({
    method: "POST",
    path: `${this.url}/:id/prices/remove`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Take a price off: the product stops selling in that currency",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: priceInputSchema.pick({ currency: true, variantId: true }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: async ({ params, body }) => {
      await this.prices.remove(params.id, body);
      return { deleted: true };
    },
  });

  /**
   * A product's variants with their stock figures: the matrix the Variants tab
   * edits.
   */
  public readonly commerceAdminProductVariants = $action({
    method: "GET",
    path: `${this.url}/:id/variants`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List a product's variants, with stock figures",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(adminVariantSchema),
    },
    handler: async ({ params }) =>
      this.withFigures(params.id, await this.variants.listOf(params.id)),
  });

  /**
   * Write the combinations of the product's option groups that are missing.
   * What exists keeps its stock, price and SKU.
   */
  public readonly commerceAdminProductVariantsGenerate = $action({
    method: "POST",
    path: `${this.url}/:id/variants/generate`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Generate the missing combinations of the option groups",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(adminVariantSchema),
    },
    handler: async ({ params }) => {
      const product = await this.catalog.getById(params.id);
      return this.withFigures(params.id, await this.variants.generate(product));
    },
  });

  public readonly commerceAdminProductVariantCreate = $action({
    method: "POST",
    path: `${this.url}/:id/variants`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Add a variant",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: variantInputSchema,
      response: productVariants.schema,
    },
    handler: async ({ params, body }) => this.variants.create(params.id, body),
  });

  public readonly commerceAdminProductVariantUpdate = $action({
    method: "PUT",
    path: `${this.url}/:id/variants/:variantId`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Update a variant",
    schema: {
      params: z.object({ id: z.uuid(), variantId: z.uuid() }),
      body: variantInputSchema.partial(),
      response: productVariants.schema,
    },
    handler: async ({ params, body }) =>
      this.variants.update(params.variantId, body),
  });

  public readonly commerceAdminProductVariantDelete = $action({
    method: "DELETE",
    path: `${this.url}/:id/variants/:variantId`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Delete a variant that has never been ordered",
    schema: {
      params: z.object({ id: z.uuid(), variantId: z.uuid() }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: async ({ params }) => {
      await this.variants.delete(params.variantId);
      return { deleted: true };
    },
  });

  /**
   * The product's stock ledger - every movement and why it happened.
   *
   * The table has always been written and never read: on-hand is a sum over it,
   * so "why is this 3?" had no answer anywhere in the back office.
   */
  public readonly commerceAdminProductMovements = $action({
    method: "GET",
    path: `${this.url}/:id/movements`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List a product's stock movements",
    schema: {
      params: z.object({ id: z.uuid() }),
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
      }),
      response: db.page(stockMovements.schema),
    },
    handler: async ({ params, query }) =>
      this.stock.movementsOf(params.id, query),
  });

  /**
   * Order lines that sold this product, newest first.
   *
   * Lines rather than orders: one order can contain the same product twice at
   * different prices, and each line carries the price it actually sold at.
   */
  public readonly commerceAdminProductOrders = $action({
    method: "GET",
    path: `${this.url}/:id/orders`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List the order lines that sold this product",
    schema: {
      params: z.object({ id: z.uuid() }),
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
      }),
      response: db.page(productOrderLineSchema),
    },
    handler: async ({ params, query }) =>
      this.orders.linesOfProduct(params.id, query),
  });

  /**
   * Delete a product outright.
   *
   * Exists because there is no create form: "New product" writes a real draft
   * row, so a mis-click needs an undo. `CatalogService.delete` refuses once the
   * product appears on any order line, answering 409 rather than destroying the
   * row an old invoice refers to.
   */
  public readonly commerceAdminProductDelete = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Delete a product that has never been ordered",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: async ({ params }) => {
      await this.catalog.delete(params.id);
      return { deleted: true };
    },
  });

  protected async withFigures(
    productId: string,
    variants: ProductVariantEntity[],
  ) {
    const stock = await this.stock.figuresFor([productId]);
    return variants.map((variant) => ({
      ...variant,
      ...stock.of(productId, variant.id),
    }));
  }

  /**
   * The variant a stock movement lands on. A product sold by variant takes
   * none at product level: units there could never be sold.
   */
  protected async stockTarget(
    productId: string,
    variantId?: string,
  ): Promise<string | undefined> {
    const variants = await this.variants.listOf(productId);
    // A variant switched off still takes a correction: only selling stops.
    if (variantId && variants.some((it) => it.id === variantId)) {
      return variantId;
    }
    const product = await this.catalog.getById(productId);
    return this.variants.pick(product, variants, variantId)?.id;
  }
}
