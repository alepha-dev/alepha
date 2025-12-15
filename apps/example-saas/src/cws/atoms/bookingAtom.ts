import { $atom, type Static, t } from "alepha";
import {
  type Passenger,
  passengerSchema,
} from "../../api/bookings/schemas/passengerSchema.ts";
import {
  type SeatView,
  seatSchema,
} from "../../api/inventory/schemas/seatSchema.ts";
import {
  type TripResource,
  tripSchema,
} from "../../api/topology/schemas/tripSchema.ts";

// Fare class selection schema
export const fareClassSelectionSchema = t.object({
  id: t.uuid(),
  code: t.text(),
  name: t.text(),
  description: t.text(),
  price: t.number(),
  priceMultiplier: t.number(),
  dynamicMultiplier: t.number(),
  isRefundable: t.boolean(),
  isChangeable: t.boolean(),
  changeFeePercent: t.number(),
  refundFeePercent: t.number(),
});

// Seat reservation schema
export const seatReservationSchema = t.object({
  seatNumbers: t.array(t.text()), // Seat numbers like "1-4A", "2-1B"
  reservedUntil: t.datetime(),
});

// Selected add-on schema
export const selectedAddOnSchema = t.object({
  productId: t.uuid(),
  productName: t.text(),
  productSku: t.text(),
  category: t.text(),
  quantity: t.integer({ minimum: 1 }),
  unitPrice: t.number(),
  taxRate: t.number(),
  total: t.number(),
});

export type SelectedAddOn = Static<typeof selectedAddOnSchema>;

export const bookingAtom = $atom({
  name: "train_booking",
  schema: t.object({
    step: t.enum([
      "search",
      "results",
      "fareclass",
      "seats",
      "addons",
      "payment",
      "confirmation",
    ]),
    search: t.optional(
      t.object({
        from: t.text(),
        to: t.text(),
        date: t.text(),
        passengers: t.integer(),
      }),
    ),
    selectedTrip: t.optional(tripSchema),

    // Yield management fields
    tripInstanceId: t.optional(t.uuid()),
    selectedFareClass: t.optional(fareClassSelectionSchema),
    seatReservation: t.optional(seatReservationSchema),
    lockedPrice: t.optional(t.number()),
    priceValidUntil: t.optional(t.datetime()),
    dynamicMultiplier: t.optional(t.number()),

    selectedSeats: t.array(seatSchema),
    passenger: t.optional(passengerSchema),
    bookingReference: t.optional(t.text()),

    // Add-ons
    selectedAddOns: t.array(selectedAddOnSchema),
    addOnsTotal: t.optional(t.number()),
  }),
  default: {
    step: "search",
    selectedSeats: [],
    selectedAddOns: [],
  },
});

export type FareClassSelection = Static<typeof fareClassSelectionSchema>;
export type SeatReservation = Static<typeof seatReservationSchema>;

// Re-export types from schemas for convenience
export type { Passenger, SeatView as Seat, TripResource as Trip };
export type BookingState = Static<typeof bookingAtom.schema>;
