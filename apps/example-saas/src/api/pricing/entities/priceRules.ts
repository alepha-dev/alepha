import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const priceRules = $entity({
  name: "price_rules",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Rule identification
    name: t.text(),
    description: t.text(),
    ruleType: pg.enum([
      "occupancy", // Price increases with occupancy
      "time_to_departure", // Price increases closer to departure
      "day_of_week", // Weekend/weekday pricing
      "peak_hours", // Rush hour pricing
    ]),

    // Rule configuration (JSON for flexibility)
    // For occupancy: { thresholds: [{ value: 50, multiplier: 1.1 }, ...] }
    // For time_to_departure: { thresholds: [{ value: 7, multiplier: 1.2 }, ...] } (days)
    // For day_of_week: { dayMultipliers: { "friday": 1.1, "saturday": 1.15 } }
    // For peak_hours: { hourMultipliers: { "07": 1.2, "08": 1.25 } }
    config: t.object({
      thresholds: t.optional(
        t.array(
          t.object({
            value: t.number(),
            multiplier: t.number(),
          }),
        ),
      ),
      dayMultipliers: t.optional(t.record(t.string(), t.number())),
      hourMultipliers: t.optional(t.record(t.string(), t.number())),
    }),

    // Priority (higher = applied later, can override)
    priority: t.integer(),

    // Active flag
    active: pg.default(t.boolean(), true),
  }),
  indexes: [{ columns: ["ruleType", "active"] }, { columns: ["priority"] }],
});

export type PriceRule = Static<typeof priceRules.schema>;
