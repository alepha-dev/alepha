import { $atom, type Static, t } from "alepha";

export const tripSchema = t.object({
  id: t.string(),
  departureStation: t.string(),
  arrivalStation: t.string(),
  departureTime: t.string(),
  arrivalTime: t.string(),
  duration: t.string(),
  trainNumber: t.string(),
  trainType: t.string(),
  price: t.number(),
  availableSeats: t.integer(),
});

export const seatSchema = t.object({
  id: t.string(),
  row: t.integer(),
  number: t.string(),
  type: t.enum(["window", "aisle", "middle"]),
  class: t.enum(["first", "second"]),
  price: t.number(),
  isAvailable: t.boolean(),
});

export const passengerSchema = t.object({
  firstName: t.string(),
  lastName: t.string(),
  email: t.email(),
});

export const bookingAtom = $atom({
  name: "train_booking",
  schema: t.object({
    step: t.enum(["search", "results", "seats", "payment", "confirmation"]),
    search: t.optional(
      t.object({
        from: t.string(),
        to: t.string(),
        date: t.string(),
        passengers: t.integer(),
      }),
    ),
    selectedTrip: t.optional(tripSchema),
    selectedSeats: t.array(seatSchema),
    passenger: t.optional(passengerSchema),
    bookingReference: t.optional(t.string()),
  }),
  default: {
    step: "search",
    selectedSeats: [],
  },
});

export type Trip = Static<typeof tripSchema>;
export type Seat = Static<typeof seatSchema>;
export type Passenger = Static<typeof passengerSchema>;
export type BookingState = Static<typeof bookingAtom.schema>;
