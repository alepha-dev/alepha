import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

/**
 * The capabilities a sigil may grant. Declared once here and reused by the
 * SigilController body schema and the Settings → Sigils UI so the literal
 * list never drifts. NB: `"petition"` is singular — it names the per-sigil
 * capability, distinct from the campaign-level `petitions` feature
 * toggle that gates it.
 */
export const SIGIL_KINDS = ["petition", "blights", "beacon", "vitals"] as const;

export type SigilKind = (typeof SIGIL_KINDS)[number];

/**
 * A **sigil** is a scoped, revocable, owner-issued identifier that lets a
 * partner server forward telemetry and petitions to Lore via the trusted
 * server-to-server ingest endpoints (`POST /sigils/:id/ingest`,
 * `POST /sigils/:id/petition`).
 *
 * - `id` — a random, opaque identifier and the primary key. It is the
 *   **sole credential** on the trusted server-to-server ingest path (the
 *   sigil UUID is the only thing that authenticates `POST /sigils/:id/*`).
 *   Stored as a `text` PRIMARY KEY column. NB: the type is `t.uuid()` rather
 *   than a free-form 16-hex string because the Alepha SQLite model builder
 *   only honors `PRIMARY KEY` on uuid-format strings — a plain `t.string()`
 *   PK silently degrades to a non-PK column.
 * - `ingestKey` — VESTIGIAL. A random secret that once gated the now-deleted
 *   browser-embed `.js` surface (removed in "remove legacy sigil embed
 *   surface"). No live code path reads or verifies it anymore; it is minted
 *   on insert only to satisfy the `NOT NULL` constraint and kept in the
 *   schema only because dropping it is a D1 cascade bomb (see `revokedAt`).
 *
 * A sigil scopes what a site may do (`kinds`). Deleting a sigil
 * hard-deletes the row (the `revokedAt` column is vestigial — see its
 * field doc).
 */
export const sigils = $entity({
  name: "sigils",
  schema: t.object({
    /**
     * Random opaque identifier and the ingest credential — a partner server
     * holds it and presents it as the `:id` in `POST /sigils/:id/*`. `text`
     * PRIMARY KEY; see the entity-level note on why the type is `t.uuid()`.
     */
    id: db.primaryKey(t.uuid()),
    /**
     * VESTIGIAL secret — once gated the now-deleted browser-embed surface.
     * Nothing reads it today; minted on insert only to satisfy `NOT NULL`.
     * See the entity-level doc.
     */
    ingestKey: t.string({ minLength: 1, maxLength: 128 }),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Human-readable label for the owner's inventory, e.g.
     * "shop.example.com checkout".
     */
    label: t.string({ minLength: 1, maxLength: 200 }),
    /**
     * VESTIGIAL — kept because dropping it on D1 is a cascade bomb (same
     * precedent as `revokedAt` and `campaign.public`). Never enforced: the
     * proxy model means Lore only ever sees server-to-server calls and never
     * receives the real browser `Origin`. Do not add enforcement logic here.
     */
    allowedOrigins: db.default(
      t.array(t.string({ maxLength: 200 }), { maxItems: 20 }),
      [],
    ),
    /**
     * Capabilities this sigil grants — a subset of
     * `["petition", "blights", "beacon"]`.
     */
    kinds: db.default(
      t.array(t.string({ maxLength: 50 }), { maxItems: 10 }),
      [],
    ),
    /**
     * Glob patterns that suppress telemetry collection on matching pages
     * of the host site. Empty (default) → no exclusions, all paths are
     * collected. `*` matches any chars within a path segment (no `/`);
     * `**` matches across segments. Matched against the pathname only —
     * no host, no query. See `sigilGlobMatch` for the matcher implementation.
     */
    excludedPaths: db.default(
      t.array(t.string({ maxLength: 200 }), { maxItems: 50 }),
      [],
    ),
    /**
     * The user who issued the sigil. NULLABLE on purpose: a future
     * migration-seeded "Lore-self" sigil (#90) has no human creator and
     * must still be a valid row.
     */
    createdBy: db.ref(t.optional(t.uuid()), () => users.cols.id),
    createdAt: db.createdAt(),
    /**
     * VESTIGIAL — kept only because dropping it is a D1 cascade bomb.
     *
     * Sigils were once soft-revoked (this column flipped non-null); they
     * are now HARD-deleted by `SigilController.deleteSigil`, so no live row
     * ever carries a value here. The column is intentionally NOT removed:
     * dropping a column from `sigils` makes drizzle-kit emit a table
     * rebuild (`CREATE __new` / `INSERT SELECT` / `DROP TABLE sigils` /
     * `RENAME`), and on Cloudflare D1 the `DROP TABLE` cascade-wipes
     * `sigil_blights` / `sigil_views` / etc. (see CLAUDE.md "Migration
     * safety on D1"). Same precedent as the retained `campaign.public`
     * column. Leave it untouched.
     */
    revokedAt: db.deletedAt(),
  }),
  indexes: [
    { columns: ["campaignId", "revokedAt"] },
    { columns: ["createdBy"] },
  ],
});

export type Sigil = Static<typeof sigils.schema>;
export type SigilInsert = Static<typeof sigils.insertSchema>;
