import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";
import { trips } from "../../topology/entities/trips.ts";

/**
 * Fare quota tracking per fare class.
 * Stored as JSONB object keyed by fare class code.
 */
export const fareQuotaSchema = t.object({
  fareClassId: t.uuid(),
  totalQuota: t.integer(), // Total seats allocated to this fare class
  bookedCount: t.integer(), // Currently booked
  reservedCount: t.integer(), // Temporarily reserved (in checkout)
  status: t.enum(["available", "sold_out", "closed"]),
});

export type FareQuota = Static<typeof fareQuotaSchema>;

export const tripInstances = $entity({
  name: "trip_instances",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Reference to the trip template
    tripId: pg.ref(t.uuid(), () => trips.cols.id),

    // The specific date for this instance (ISO format: "2025-01-15")
    travelDate: t.text(),

    // Seat layout reference (for computing available seats)
    seatLayoutId: t.optional(t.uuid()),

    // Cached availability counts (updated when bookings change)
    availableFirstClass: t.integer(),
    availableSecondClass: t.integer(),
    totalSeats: t.integer(),

    // Fare quotas per fare class (JSONB - keyed by fare class code)
    // e.g., { "PROMO": { fareClassId: "...", totalQuota: 50, bookedCount: 10, ... }, ... }
    fareQuotas: pg.default(t.record(t.text(), fareQuotaSchema), {}),

    // Booked seats tracking (sparse - only store seat numbers that are booked)
    // This is a denormalized cache for quick availability checks
    // Format: ["1-4A", "1-4B", "2-1A"] (wagon-row+position)
    bookedSeats: pg.default(t.array(t.text()), []),

    // Current dynamic price multiplier (cached for performance)
    currentPriceMultiplier: pg.default(t.number(), 1.0),

    // Status
    status: pg.default(
      pg.enum(["scheduled", "boarding", "departed", "cancelled"]),
      "scheduled",
    ),
  }),
  indexes: [
    { columns: ["tripId", "travelDate"], unique: true },
    { columns: ["travelDate"] },
    { columns: ["status"] },
  ],
});

export type TripInstance = Static<typeof tripInstances.schema>;
