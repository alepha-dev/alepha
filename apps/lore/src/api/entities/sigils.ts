import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

/**
 * The capabilities a sigil may grant. Declared once here and reused by the
 * SigilController body schema and the Settings → Sigils UI so the literal
 * list never drifts. NB: `"petition"` is singular — it names the per-sigil
 * capability, distinct from the campaign-level `embeddedPetitions` feature
 * toggle that gates it.
 */
export const SIGIL_KINDS = ["petition", "blights", "beacon", "vitals"] as const;

export type SigilKind = (typeof SIGIL_KINDS)[number];

/**
 * A **sigil** is a scoped, revocable, owner-issued identifier that lets a
 * site embed Lore capabilities via one
 * `<script src=".../sigils/<id>/embed.js">` line.
 *
 * Two credentials live on each sigil:
 *
 * - `id` — a random, opaque identifier and the primary key. PUBLIC by
 *   design: it sits in the partner page's `<script>` tag, so it leaks
 *   nothing on its own. Stored as a `text` PRIMARY KEY column. NB: the type
 *   is `t.uuid()` rather than a free-form 16-hex string because the Alepha
 *   SQLite model builder only honors `PRIMARY KEY` on uuid-format strings —
 *   a plain `t.string()` PK silently degrades to a non-PK column. A UUID is
 *   random and public-safe; shortening the id to 16-hex would need a paired
 *   upstream framework change and can be revisited when the issuing
 *   controller lands.
 * - `ingestKey` — a separate random secret baked into the served `.js` body
 *   and required on the unauthenticated ingestion POSTs. It is a *speed
 *   bump*, not real auth, and is rotatable WITHOUT reissuing the sigil `id`.
 *
 * A sigil scopes what a site may do (`kinds`) and from where
 * (`allowedOrigins`). Deleting a sigil hard-deletes the row (the
 * `revokedAt` column is vestigial — see its field doc).
 */
export const sigils = $entity({
  name: "sigils",
  schema: t.object({
    /**
     * Random opaque identifier. PUBLIC — embedded in the partner page's
     * `<script>` src. `text` PRIMARY KEY; see the entity-level note on why
     * the type is `t.uuid()`.
     */
    id: db.primaryKey(t.uuid()),
    /**
     * Random secret baked into the served `.js` body, required on the
     * unauthenticated ingestion POSTs. Distinct from the public `id` and
     * rotatable without reissuing the sigil.
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
     * Origins (scheme + host) the sigil's served script may be embedded
     * from. Empty means no origin has been allow-listed yet.
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
     * Glob patterns that suppress every rendered embed surface (today
     * the petition button) on matching pages of the host site. Empty
     * (default) → no exclusions, embed mounts everywhere.
     *
     * `*` matches any chars within a path segment (no `/`); `**` matches
     * across segments. Matched against `window.location.pathname` only —
     * no host, no query. See `SigilEmbedBundle` for the inline matcher.
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
