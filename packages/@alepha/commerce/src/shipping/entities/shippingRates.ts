import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { shippingZones } from "./shippingZones.ts";

/**
 * One shipping option offered inside a zone.
 *
 * `freeAbove` exists because "free delivery over €X" is the single most common
 * rule in small retail, and expressing it as a rate property rather than a
 * discount keeps it out of the (absent) promotions module.
 */
export const shippingRates = $entity({
  name: "commerce_shipping_rates",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    zoneId: db.ref(z.uuid(), () => shippingZones.cols.id, {
      onDelete: "cascade",
    }),

    /**
     * Stable identifier written onto the order (`orders.shippingMethod`), which
     * is why it is a slug and not the uuid: an order must stay readable after
     * the rate row is deleted, and "colissimo" is readable.
     *
     * Unique per organisation - see the index below. That is what makes it
     * safe to write onto the order in the first place.
     */
    code: z.text({ minLength: 1, maxLength: 64 }),

    name: z.text({ minLength: 1, maxLength: 100 }),

    /**
     * Tax-inclusive price, in the smallest currency unit.
     */
    price: z.integer().min(0),

    /**
     * Free when the cart subtotal reaches this. Null → never free.
     */
    freeAbove: z.integer().min(0).optional(),

    /**
     * Shown to the buyer as an estimate.
     */
    minDays: z.integer().min(0).optional(),
    maxDays: z.integer().min(0).optional(),

    active: db.default(z.boolean(), true),
  }),
  indexes: [
    { columns: ["zoneId"] },
    /**
     * Unique, not merely indexed.
     *
     * `code` is what gets written onto the order, so two rates sharing one in
     * an organisation makes the order ambiguous about what was actually
     * bought - and the admin then edits whichever row the query happened to
     * return first. `products.slug` and `invoices.number` are unique for the
     * same reason.
     */
    { columns: ["organizationId", "code"], unique: true },
  ],
});

export type ShippingRateEntity = Infer<typeof shippingRates.schema>;
