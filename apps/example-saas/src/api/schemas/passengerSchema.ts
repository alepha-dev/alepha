import { type Static, t } from "alepha";

export const passengerSchema = t.object({
  firstName: t.text(),
  lastName: t.text(),
  email: t.email(),
});

export type Passenger = Static<typeof passengerSchema>;
