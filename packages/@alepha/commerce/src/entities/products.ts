import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A sellable catalog row.
 *
 * ### Why `kind` is free text and not an enum
 *
 * An add-on module cannot extend a `z.enum` declared here, and it cannot add a
 * column to this table either — entities are code, migrations are per-app. So
 * the set of kinds is open, and each module *registers* the kinds it
 * understands with `ProductKindRegistry`, supplying a config schema and a
 * `fulfil` implementation.
 *
 * Core ships `good` and `digital`. A point-of-sale module adds `wallet_topup`,
 * a ticketing module adds `seat` — neither has to touch this file.
 *
 * `config` is the per-kind payload, validated by the registered handler and
 * opaque to the core. It is deliberately not queryable in SQL: when a query
 * needs a field, that field earns a real column here.
 */
export const products = $entity({
  name: "commerce_products",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    /** Registered with {@link ProductKindRegistry}. Core knows `good`. */
    kind: db.default(z.text({ maxLength: 64 }), "good"),

    /** URL-safe identifier, unique per tenant. What the storefront routes on. */
    slug: z.text({ minLength: 1, maxLength: 200 }),
    name: z.text({ minLength: 1, maxLength: 200 }),
    description: z.text({ maxLength: 4000 }).optional(),

    /** What the buyer pays, in the smallest currency unit (cents). */
    price: z.integer().min(0),
    currency: db.default(z.text({ minLength: 3, maxLength: 3 }), "EUR"),

    categoryId: z.uuid().optional(),

    /**
     * Images, first one first — that is the one a listing shows.
     *
     * Each entry is either a file id from `alepha/api/files` (served by that
     * module at `/public/files/{id}`) or an absolute URL. Kept as plain text
     * rather than a `db.ref` to the `files` table on purpose: coupling the
     * catalog to that module would force every consumer to carry its tables,
     * and a shop serving images from a CDN has no file rows at all.
     */
    images: db.default(z.array(z.text({ maxLength: 500 })), []),

    /** Kind-specific payload. Validated by the registered handler. */
    config: z.json().optional(),

    /**
     * Descriptive attributes a storefront displays: material, weight,
     * dimensions, care instructions.
     *
     * Separate from {@link config} because config is *validated by the kind's
     * handler*, which strips anything the handler does not declare — the first
     * version of this shop put its spec sheet in `config` and watched it vanish
     * on write. That stripping is correct for a payload `fulfil` relies on, and
     * wrong for free-form copy, so the two live apart.
     *
     * Not queryable, deliberately: an attribute that needs filtering has earned
     * a real column.
     */
    attributes: z.json().optional(),

    /** Draft rows are invisible to the public catalog. */
    published: db.default(z.boolean(), false),
  }),
  indexes: [
    { columns: ["organizationId"] },
    { columns: ["organizationId", "slug"], unique: true },
    { columns: ["organizationId", "kind"] },
    { columns: ["organizationId", "published"] },
  ],
});

export type ProductEntity = Infer<typeof products.schema>;
