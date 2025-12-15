import { type Static, t } from "alepha";

/**
 * Seat resource schema for API responses.
 */
export const seatResourceSchema = t.object({
  seatNumber: t.text(), // Seat identifier (e.g., "1-4A" for wagon-row+position)
  row: t.integer(),
  position: t.text(), // A, B, C, D, E, etc. (flexible for different train types)
  seatClass: t.enum(["first", "second"]),
  seatType: t.enum(["window", "aisle", "middle"]),
  status: t.enum(["available", "reserved", "booked", "blocked"]),
  seatPremium: t.number(),
});

export type SeatResource = Static<typeof seatResourceSchema>;
