import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { products } from "./products.ts";

/**
 * One sellable combination of a product's options: the ring in size 56, the
 * shirt in blue and M.
 *
 * The product stays what the catalogue lists and routes on. A product with any
 * row here sells only through one of them, whether or not that row is active:
 * otherwise switching the last variant off would quietly turn the product back
 * into a single sellable unit with its own price and an empty ledger. See
 * `VariantService.pick`.
 *
 * A variant that has sold is switched off rather than deleted, for the reason a
 * product is unpublished: order lines and the ledger still name it.
 */
export const productVariants = $entity({
  name: "commerce_product_variants",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    productId: db.ref(z.uuid(), () => products.cols.id, {
      onDelete: "cascade",
    }),

    /**
     * The merchant's reference. Unique across the catalogue: it is what a
     * picking list and a stock count go by.
     */
    sku: z.text({ minLength: 1, maxLength: 64 }),

    /**
     * One value per option group of the product: `{ Taille: "56" }`.
     */
    options: z.json(),

    /**
     * What this variant sells for, or unset to take the product's price.
     */
    price: z.integer().min(0).optional(),

    /**
     * Struck through beside the price, or unset to take the product's.
     */
    compareAtPrice: z.integer().min(0).optional(),

    /**
     * A file id or an absolute URL, shown instead of the product's first image.
     */
    image: z.text({ maxLength: 500 }).optional(),

    /**
     * Or unset to take the product's.
     */
    weightGrams: z.integer().min(0).optional(),

    /**
     * Lower sorts first. Generated combinations come in the order of the
     * option groups.
     */
    position: db.default(z.integer(), 0),

    active: db.default(z.boolean(), true),
  }),
  indexes: [{ columns: ["sku"], unique: true }, { columns: ["productId"] }],
});

export type ProductVariantEntity = Infer<typeof productVariants.schema>;
