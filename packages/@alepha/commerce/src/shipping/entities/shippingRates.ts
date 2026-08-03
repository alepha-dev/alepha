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
     */
    code: z.text({ minLength: 1, maxLength: 64 }),

    name: z.text({ minLength: 1, maxLength: 100 }),

    /** Tax-inclusive price, in the smallest currency unit. */
    price: z.integer().min(0),

    /** Free when the cart subtotal reaches this. Null → never free. */
    freeAbove: z.integer().min(0).optional(),

    /** Shown to the buyer as an estimate. */
    minDays: z.integer().min(0).optional(),
    maxDays: z.integer().min(0).optional(),

    active: db.default(z.boolean(), true),
  }),
  indexes: [{ columns: ["zoneId"] }, { columns: ["organizationId", "code"] }],
});

export type ShippingRateEntity = Infer<typeof shippingRates.schema>;
