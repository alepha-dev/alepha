import { $atom, type Static, t } from "alepha";
import {
  type Passenger,
  passengerSchema,
  type Seat,
  seatSchema,
  type Trip,
  tripSchema,
} from "../../api/schemas/index.ts";

export const bookingAtom = $atom({
  name: "train_booking",
  schema: t.object({
    step: t.enum(["search", "results", "seats", "payment", "confirmation"]),
    search: t.optional(
      t.object({
        from: t.text(),
        to: t.text(),
        date: t.text(),
        passengers: t.integer(),
      }),
    ),
    selectedTrip: t.optional(tripSchema),
    selectedSeats: t.array(seatSchema),
    passenger: t.optional(passengerSchema),
    bookingReference: t.optional(t.text()),
  }),
  default: {
    step: "search",
    selectedSeats: [],
  },
});

// Re-export types from schemas for convenience
export type { Passenger, Seat, Trip };
export type BookingState = Static<typeof bookingAtom.schema>;
