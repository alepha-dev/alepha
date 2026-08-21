import { $relations } from "alepha/orm";

import { bookings, courts, invoices, participants } from "./entities.ts";

export const tenantSchema = { courts, bookings, participants, invoices };

export const tenantRelations = $relations(tenantSchema, (r) => ({
  courts: {
    bookings: r.many.bookings({ from: r.courts.id, to: r.bookings.courtId }),
  },
  bookings: {
    court: r.one.courts({ from: r.bookings.courtId, to: r.courts.id }),
    participants: r.many.participants({
      from: r.bookings.id,
      to: r.participants.bookingId,
    }),
    invoices: r.many.invoices({
      from: r.bookings.id,
      to: r.invoices.bookingId,
    }),
  },
  participants: {
    booking: r.one.bookings({
      from: r.participants.bookingId,
      to: r.bookings.id,
    }),
  },
  invoices: {
    booking: r.one.bookings({ from: r.invoices.bookingId, to: r.bookings.id }),
  },
}));
