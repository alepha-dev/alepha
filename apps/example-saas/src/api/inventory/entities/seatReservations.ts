import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";
import { tripInstances } from "./tripInstances.ts";

/**
 * Temporary seat reservations during checkout.
 *
 * This is a sparse table - only holds seats that are currently reserved (in checkout).
 * Once a booking is confirmed, the reservation is deleted and seats are stored in bookings.seats.
 *
 * To check seat availability:
 * - Available = (layout seats) - (booked from bookings.seats) - (reserved from seatReservations)
 */
export const seatReservations = $entity({
  name: "seat_reservations",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),

    // Reference to trip instance
    tripInstanceId: pg.ref(t.uuid(), () => tripInstances.cols.id),

    // Seat identification (from layout)
    seatNumber: t.text(), // "1-4A" (wagon-row+position)
    seatClass: pg.enum(["first", "second"]),

    // Reservation tracking
    sessionId: t.text(), // Checkout session holding this reservation
    expiresAt: t.datetime(), // When this reservation expires (typically 10-15 min)

    // Price locked at reservation time
    seatPremium: pg.default(t.number(), 0),
  }),
  indexes: [
    { columns: ["tripInstanceId", "seatNumber"], unique: true },
    { columns: ["sessionId"] },
    { columns: ["expiresAt"] }, // For cleanup job
  ],
});

export type SeatReservation = Static<typeof seatReservations.schema>;
