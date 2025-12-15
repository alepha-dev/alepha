import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const bookings = $entity({
  name: "bookings",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Reference code for the booking (e.g., "AB12CD")
    reference: t.text({ minLength: 6, maxLength: 6 }),

    // Trip details
    departureStation: t.text(),
    arrivalStation: t.text(),
    departureTime: t.text(),
    arrivalTime: t.text(),
    travelDate: t.text(),
    trainNumber: t.text(),
    trainType: t.text(),

    // Passenger info
    passengerFirstName: t.text(),
    passengerLastName: t.text(),
    passengerEmail: t.email(),

    // Seats (stored as JSON array)
    seats: t.array(
      t.object({
        id: t.optional(t.uuid()), // Seat ID from inventory (when using yield management)
        number: t.text(),
        class: t.enum(["first", "second"]),
        price: t.number(),
      }),
    ),

    // Pricing
    baseFare: t.number(),
    seatUpgrades: t.number(),
    totalPrice: t.number(),
    passengerCount: t.integer(),

    // Status
    status: pg.default(
      pg.enum(["pending", "confirmed", "cancelled"]),
      "confirmed",
    ),

    // Yield management fields
    tripInstanceId: t.optional(t.uuid()), // Reference to trip instance
    fareClassId: t.optional(t.uuid()), // Reference to fare class used
    fareClassName: t.optional(t.text()), // Denormalized for display

    // Price lock (calculated at booking time)
    lockedBasePrice: t.optional(t.number()), // The base price locked at booking
    priceMultiplierApplied: t.optional(t.number()), // Dynamic multiplier used
    priceCalculatedAt: t.optional(t.datetime()), // When price was calculated
  }),
  indexes: [
    { columns: ["reference"], unique: true },
    { columns: ["tripInstanceId"] },
    { columns: ["fareClassId"] },
  ],
});

export type Booking = Static<typeof bookings.schema>;
