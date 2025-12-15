import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const fareClasses = $entity({
  name: "fare_classes",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Fare class identification
    code: t.text(), // "SAVER", "STANDARD", "FLEX"
    name: t.text(), // "Saver Fare", "Standard Fare", "Flexible Fare"
    description: t.text(),

    // Pricing
    priceMultiplier: t.number(), // 0.7, 1.0, 1.4

    // Booking rules
    isRefundable: t.boolean(),
    isChangeable: t.boolean(),
    changeFeePercent: t.number(), // 0 for free, 0.15 for 15% fee
    refundFeePercent: t.number(), // 0 for free, 0.25 for 25% fee

    // Restrictions
    minDaysBeforeDeparture: t.integer(), // Saver may require 7+ days advance

    // Display order (lower = shown first)
    sortOrder: t.integer(),

    // Active flag
    active: pg.default(t.boolean(), true),
  }),
  indexes: [
    { columns: ["code"], unique: true },
    { columns: ["active", "sortOrder"] },
  ],
});

export type FareClass = Static<typeof fareClasses.schema>;
