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
    toId: db.ref(t.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
  }),
  indexes: [
    /** Look up outbound links from a folio. Also enforces no-duplicates. */
    { columns: ["fromId", "toId"], unique: true },
    /** Look up backlinks — every folio that points TO this one. */
    { columns: ["toId"] },
  ],
});

export type FolioLink = Static<typeof folioLinks.schema>;
