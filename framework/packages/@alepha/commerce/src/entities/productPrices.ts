import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { products } from "./products.ts";

/**
 * What a product sells for in another currency: a price list, not a conversion.
 *
 * A shop prices Switzerland in round francs and has its reasons, and a figure
 * moved by a nightly rate is not one a buyer can be shown twice. So every price
 * here was written by someone, and a product with no row in a currency is not
 * on sale in it. The product's own `price` and `currency` stay what they were:
 * the entry for that one currency, which is why this table refuses a row for it.
 *
 * `variantKey` is a variant's id, or `""` for the product. A nullable column
 * could not carry the unique index: two NULLs are two different values.
 */
export const productPrices = $entity({
  name: "commerce_product_prices",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    productId: db.ref(z.uuid(), () => products.cols.id, {
      onDelete: "cascade",
    }),

    variantKey: db.default(z.text({ maxLength: 36 }), ""),

    currency: z.text({ minLength: 3, maxLength: 3 }),

    /**
     * Tax included, in the smallest currency unit.
     */
    price: z.integer().min(0),
  }),
  indexes: [
    { columns: ["productId", "variantKey", "currency"], unique: true },
    { columns: ["currency"] },
    { columns: ["variantKey"] },
  ],
});

export type ProductPriceEntity = Infer<typeof productPrices.schema>;
