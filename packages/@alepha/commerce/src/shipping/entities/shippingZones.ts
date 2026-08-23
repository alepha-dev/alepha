import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A set of countries that share shipping rates.
 *
 * Countries are stored as an array of ISO 3166-1 alpha-2 codes rather than a
 * join table. A zone has a handful of countries and is read on every checkout,
 * so a join buys nothing; and "which zone covers FR" is answered in the service
 * from a small in-memory set, not by SQL.
 */
export const shippingZones = $entity({
  name: "commerce_shipping_zones",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    name: z.text({ minLength: 1, maxLength: 100 }),

    /**
     * ISO 3166-1 alpha-2, upper case.
     */
    countries: z.array(z.text({ minLength: 2, maxLength: 2 })),

    /**
     * Lower sorts first. The first zone that covers the destination wins, so a
     * narrow zone (`FR`) must sort before a broad one (all of the EU).
     */
    priority: db.default(z.integer(), 0),
  }),
  indexes: [
    { columns: ["organizationId"] },
    { columns: ["organizationId", "priority"] },
  ],
});

export type ShippingZoneEntity = Infer<typeof shippingZones.schema>;
