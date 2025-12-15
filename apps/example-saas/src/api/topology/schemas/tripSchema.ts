import { type Static, t } from "alepha";

/**
 * Trip resource schema for API responses.
 * Contains denormalized station names for display.
 */
export const tripSchema = t.object({
  id: t.uuid(),
  departureStation: t.text(),
  arrivalStation: t.text(),
  departureTime: t.text(),
  arrivalTime: t.text(),
  duration: t.text(),
  trainNumber: t.text(),
  trainType: t.text(),
  price: t.number(),
  availableSeats: t.integer(),
});

export type TripResource = Static<typeof tripSchema>;
