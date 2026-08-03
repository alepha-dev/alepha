import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A postal address, in the shape every EU country can be expressed in.
 *
 * Two lines plus locality, postal code and country covers the EU-27; `region`
 * is nullable because most of them have no province field at all. A shop that
 * needs more (a door code, a delivery instruction) puts it in the order's
 * `shippingAddress` blob rather than growing this table.
 *
 * Kept as a real table, not a blob, because a signed-in customer expects their
 * address to come back next time — which is a query, and a blob is not.
 */
export const addresses = $entity({
  name: "commerce_addresses",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    /** Null for a guest checkout: the address exists but belongs to nobody. */
    userId: z.uuid().optional(),

    fullName: z.text({ minLength: 1, maxLength: 200 }),
    line1: z.text({ minLength: 1, maxLength: 200 }),
    line2: z.text({ maxLength: 200 }).optional(),
    locality: z.text({ minLength: 1, maxLength: 120 }),
    /** Province / state. Required only where the country rule says so. */
    region: z.text({ maxLength: 120 }).optional(),
    /** Stored normalised (upper case, single spaces). */
    postalCode: z.text({ minLength: 2, maxLength: 16 }),
    /** ISO 3166-1 alpha-2, upper case. */
    country: z.text({ minLength: 2, maxLength: 2 }),

    phone: z.text({ maxLength: 32 }).optional(),

    /** The one a signed-in customer gets pre-filled. */
    isDefault: db.default(z.boolean(), false),
  }),
  indexes: [
    { columns: ["organizationId", "userId"] },
    { columns: ["organizationId", "country"] },
  ],
});

export type AddressEntity = Infer<typeof addresses.schema>;

/** What a caller submits — no id, no timestamps. */
export const addressInputSchema = z.object({
  fullName: z.text({ minLength: 1, maxLength: 200 }),
  line1: z.text({ minLength: 1, maxLength: 200 }),
  line2: z.text({ maxLength: 200 }).optional(),
  locality: z.text({ minLength: 1, maxLength: 120 }),
  region: z.text({ maxLength: 120 }).optional(),
  postalCode: z.text({ minLength: 2, maxLength: 16 }),
  country: z.text({ minLength: 2, maxLength: 2 }),
  phone: z.text({ maxLength: 32 }).optional(),
});

export type AddressInput = Infer<typeof addressInputSchema>;
