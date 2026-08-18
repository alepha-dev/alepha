import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A multi-tenant slice, shaped like the one `apps/club` actually runs: a
 * pooled worker serves every tenant, and `db.organization()` is what keeps
 * them apart.
 *
 * The interesting part is `courts`: it is deliberately *shared*, so the same
 * court can be booked by two different tenants. That makes the foreign key
 * legitimately match rows from both — which is the only way to prove a
 * relation applies the tenant predicate rather than merely happening to
 * return the right rows because nothing else was there.
 */
export const courts = $entity({
  name: "courts",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.string(),
    /**
     * Nullable on purpose: a NULL organization is the "global row" a
     * non-strict tenant is allowed to see.
     */
    organizationId: db.organization(),
  }),
});

export const bookings = $entity({
  name: "bookings",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    label: z.string(),
    courtId: db.ref(z.integer(), () => courts.cols.id, { onDelete: "cascade" }),
    organizationId: db.organization(),
  }),
});

export const participants = $entity({
  name: "participants",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.string(),
    bookingId: db.ref(z.integer(), () => bookings.cols.id, {
      onDelete: "cascade",
    }),
    organizationId: db.organization(),
  }),
});

/**
 * The fail-closed variant. A strict entity has no "global row" escape, and a
 * read with no resolved tenant refuses rather than returning everything.
 */
export const invoices = $entity({
  name: "invoices",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    amount: z.integer(),
    bookingId: db.ref(z.integer(), () => bookings.cols.id, {
      onDelete: "cascade",
    }),
    organizationId: db.organization({ strict: true }),
  }),
});

export type Court = Infer<typeof courts.schema>;
export type Booking = Infer<typeof bookings.schema>;
