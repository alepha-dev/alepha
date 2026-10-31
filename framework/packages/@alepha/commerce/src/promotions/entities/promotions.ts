import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * What a promotion takes off.
 *
 * - `percent`: `value` is basis points of the items (1000 = 10 %).
 * - `amount`: `value` is tax-inclusive, in the smallest currency unit.
 * - `freeShipping`: delivery is on the house, `value` is unused.
 */
export const promotionKindEnum = z.enum(["percent", "amount", "freeShipping"]);

/**
 * A discount and the conditions it applies under.
 *
 * With a `code`, the buyer asks for it. Without one, it is an automatic
 * discount: every cart that qualifies gets it, and the best one wins. A cart
 * takes one promotion, and an applied code beats any automatic one: a buyer who
 * typed a code expects to see that code at work, and stacking rules is what
 * turns a promotion table into a margin leak.
 *
 * Nothing here is copied onto an order by reference: the order freezes what it
 * was given, so editing a promotion never rewrites a sale.
 */
export const promotions = $entity({
  name: "commerce_promotions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * What the buyer reads on the cart: "Soldes d'hiver".
     */
    name: z.text({ minLength: 1, maxLength: 120 }),

    /**
     * What the buyer types, stored upper case: a code read aloud or copied
     * from an email should not depend on its case. Unset on an automatic
     * discount.
     */
    code: z.text({ minLength: 1, maxLength: 64 }).optional(),

    kind: promotionKindEnum,

    /**
     * See {@link promotionKindEnum}.
     */
    value: db.default(z.integer().min(0), 0),

    /**
     * The least the items must come to, tax included.
     */
    minSubtotal: z.integer().min(0).optional(),

    /**
     * What `value` and `minSubtotal` are in, the shop's own when unset. A
     * promotion stating no amount, a plain percentage, applies in any currency.
     */
    currency: z.text({ minLength: 3, maxLength: 3 }).optional(),

    /**
     * The validity window, ISO instants, either end open.
     */
    startsAt: z.text().optional(),
    endsAt: z.text().optional(),

    /**
     * How many orders may use it in total, and per customer.
     */
    usageLimit: z.integer().min(1).optional(),
    usagePerCustomer: z.integer().min(1).optional(),

    active: db.default(z.boolean(), true),
  }),
  indexes: [{ columns: ["code"], unique: true }, { columns: ["active"] }],
});

export type PromotionEntity = Infer<typeof promotions.schema>;
export type PromotionKind = PromotionEntity["kind"];
