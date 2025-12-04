import { type Static, t } from "alepha";

export const seatSchema = t.object({
  id: t.text(),
  row: t.integer(),
  number: t.text(),
  type: t.enum(["window", "aisle", "middle"]),
  class: t.enum(["first", "second"]),
  price: t.number(),
  isAvailable: t.boolean(),
});

export type Seat = Static<typeof seatSchema>;
