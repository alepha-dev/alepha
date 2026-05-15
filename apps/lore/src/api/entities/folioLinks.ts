import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { folios } from "./folios.ts";

/**
 * Outbound wiki-style links between folios. `fromId` is the folio
 * containing `[[...]]` references in its markdown content; each matched
 * reference produces one row pointing to the resolved `toId`.
 *
 * The table is **derived data** — it's re-synced from scratch on every
 * folio create/update by `FolioLinkService`. That makes the row-level
 * cascade from `folios` safe: deleting a folio drops links involving it,
 * and a hypothetical future migration that rebuilds the `folios` table
 * (which would wipe `folio_links` via cascade on D1) is recoverable by
 * triggering a re-sync — links regenerate on the next folio edit.
 *
 * NOTE on D1: per `apps/lore/CLAUDE.md`, any future migration that
 * rebuilds `folios` would cascade-wipe this table. That's acceptable for
 * derived data, but inspect the SQL anyway when reviewing future folios
 * migrations.
 */
export const folioLinks = $entity({
  name: "folio_links",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    fromId: db.ref(t.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Resolved target id. For `folio` targets this is a `folios.id` UUID;
     * for `quest` targets it's a stringified `quests.id` integer (we don't
     * FK at the row level — quests live in another table with an integer
     * key and we want a single column shape across types). Caller resolves
     * via the appropriate repository keyed on `targetType`.
     */
    toId: t.string(),
    /**
     * Discriminator for the target table. Defaults to `folio` so pre-Lore
     * #57 rows stay valid without a backfill. Add new types by extending
     * the enum here + teaching `FolioLinkService` to resolve them.
     */
    targetType: db.default(
      t.enum(["folio", "quest"], { mode: "text" }),
      "folio",
    ),
  }),
  indexes: [
    /** Look up outbound links from a folio. Also enforces no-duplicates. */
    { columns: ["fromId", "toId"], unique: true },
    /** Look up backlinks — every folio that points TO this one. */
    { columns: ["toId"] },
  ],
});

export type FolioLink = Static<typeof folioLinks.schema>;
