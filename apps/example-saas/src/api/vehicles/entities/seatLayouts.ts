import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Schema for a single seat position in a row.
 */
export const seatPositionSchema = t.object({
  position: t.text(), // A, B, C, D, etc.
  seatType: t.enum(["window", "aisle", "middle"]),
  seatClass: t.enum(["first", "second"]),
  premium: t.number(), // Additional cost for this seat
  blocked: t.optional(t.boolean()), // If true, seat is not bookable (e.g., crew area)
});

/**
 * Schema for a row of seats.
 */
export const seatRowSchema = t.object({
  rowNumber: t.integer(),
  seats: t.array(seatPositionSchema),
  isEmergencyRow: t.optional(t.boolean()),
  hasExtraLegroom: t.optional(t.boolean()),
});

/**
 * Wagon types for different car configurations.
 */
export const wagonTypes = [
  "first_class",
  "second_class",
  "mixed", // Both first and second class
  "restaurant",
  "bar",
  "quiet", // Quiet zone (no phones)
  "family", // Family-friendly car
  "business", // Business class with amenities
  "accessible", // Wheelchair accessible car
] as const;

/**
 * Schema for a wagon/carriage.
 */
export const wagonSchema = t.object({
  wagonNumber: t.integer(), // Position in the train (1, 2, 3...)
  wagonType: t.enum([
    "first_class",
    "second_class",
    "mixed",
    "restaurant",
    "bar",
    "quiet",
    "family",
    "business",
    "accessible",
  ]),
  name: t.optional(t.text()), // Optional display name (e.g., "Car 1", "Restaurant")
  rows: t.array(seatRowSchema),

  // Wagon-level configuration
  seatsPerRow: t.integer(), // Seats per row in this wagon
  aisleAfterPosition: t.optional(t.text()), // Aisle position (e.g., "B")

  // Amenities
  hasWifi: t.optional(t.boolean()),
  hasPowerOutlets: t.optional(t.boolean()),
  hasToilet: t.optional(t.boolean()),
  hasBikeStorage: t.optional(t.boolean()),
  hasLuggageRack: t.optional(t.boolean()),

  // Computed/cached values for this wagon
  totalSeats: t.optional(t.integer()),
  firstClassSeats: t.optional(t.integer()),
  secondClassSeats: t.optional(t.integer()),
});

/**
 * Seat layout entity - defines the seat configuration for a train type.
 * Now supports multiple wagons/carriages.
 */
export const seatLayouts = $entity({
  name: "seat_layouts",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Layout identification
    name: t.text(), // e.g., "Eurostar Standard", "TGV Business"
    description: t.optional(t.text()),
    trainType: t.text(), // e.g., "Eurostar", "TGV", "ICE"

    // Multi-wagon configuration
    wagons: t.array(wagonSchema),

    // Legacy single-wagon support (for backwards compatibility)
    rows: t.optional(t.array(seatRowSchema)),
    aisleAfterPosition: t.optional(t.text()),
    seatsPerRow: t.optional(t.integer()),

    // Computed/cached values (total across all wagons)
    totalSeats: t.integer(),
    firstClassSeats: t.integer(),
    secondClassSeats: t.integer(),
    totalWagons: pg.default(t.integer(), 1),

    // Status
    isDefault: pg.default(t.boolean(), false), // Default layout for train type
    active: pg.default(t.boolean(), true),
  }),
  indexes: [
    { columns: ["trainType"] },
    { columns: ["trainType", "isDefault"] },
    { columns: ["active"] },
  ],
});

export type SeatLayout = Static<typeof seatLayouts.schema>;
export type SeatPosition = Static<typeof seatPositionSchema>;
export type SeatRow = Static<typeof seatRowSchema>;
export type Wagon = Static<typeof wagonSchema>;
export type WagonType = (typeof wagonTypes)[number];
