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
      t.enum(["pending", "confirmed", "cancelled"]),
      "confirmed",
    ),
  }),
  indexes: [{ columns: ["reference"], unique: true }],
});

export type Booking = Static<typeof bookings.schema>;
