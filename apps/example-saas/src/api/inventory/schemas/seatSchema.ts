import { type Static, t } from "alepha";

export const seatSchema = t.object({
  seatNumber: t.text(), // Identifier (e.g., "1-4A")
  row: t.integer(),
  number: t.text(), // Display number
  type: t.enum(["window", "aisle", "middle"]),
  class: t.enum(["first", "second"]),
  price: t.number(),
  isAvailable: t.boolean(),
});

export type SeatView = Static<typeof seatSchema>;
