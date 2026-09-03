import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { folios } from "./folios.ts";

/**
 * Append-only revision log for folios — the folio's revision history.
 * One row per non-trivial mutation (edit / rename / tag-change / revert).
 * AI agents edit folios often; without revisions there's no recovery
 * short of "remember what it said yesterday" — which an agent can't.
 *
 * Stored in a separate table (not inline JSON on `folios`) because folio
 * content can be 5K+ chars and 10 revisions × 50KB would push the row
 * past D1's row-size ceiling. The folio row stays small; revisions sit
 * here and join when the History tab fetches them.
 *
 * FK is CASCADE on folio deletion — preserving orphan history doesn't
 * help anyone (the folio it documents is gone). Acceptable D1 cost:
 * delete a folio → its revisions go too.
 *
 * Retention is bounded by `folioHistoryAtom.maxRevisions` (default 10),
 * enforced inline on every write by `FolioHistoryService.appendRevision`
 * — `pinned` revisions are exempt and survive the trim.
 */
export const folioRevisions = $entity({
  name: "folio_revisions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    folioId: db.ref(z.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Wall-clock for "when did this revision land". Mirrors the
     * `createdAt` semantically — kept as a separate datetime so future
     * imports / backfills can carry an authoritative timestamp without
     * fighting `createdAt`'s `DEFAULT CURRENT_TIMESTAMP`.
     */
    at: z.datetime(),
    /**
     * User who made the change. `set null` on user deletion — we want
     * to keep the revision content even after an account is removed.
     */
    byUserId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * ⚠️ `tag-change` is no longer PRODUCED — the tag feature was removed
     * (feedback #62) — but it must stay in this enum: production rows
     * already carry it, and a row whose stored value is missing from the
     * schema fails to decode, taking the whole query with it. That is the
     * 2026-08-05 required-JSON-key incident, and it is a read outage, not a
     * cosmetic drift. See apps/lore/CLAUDE.md.
     */
    action: z
      .enum(["create", "edit", "rename", "tag-change", "revert"])
      .meta({ mode: "text" }),
    /**
     * Snapshot of the folio's content at the time of the revision.
     */
    contentSnapshot: z.string(),
    titleSnapshot: z.string(),
    /**
     * @deprecated Dead column — frozen at `[]` for every revision written
     * since the tag feature was removed. Kept declared for the same reason
     * as `folios.tags`: dropping it forces a table rebuild, and on D1 that
     * cascade-wipes. See the note on that column.
     */
    tagsSnapshot: db.default(z.array(z.string()), []),
    summarySnapshot: db.default(z.string(), ""),
    /**
     * UI-only pin (no MCP surface in v1). Pinned revisions are exempt
     * from the inline retention sweep — used to preserve "this was the
     * version I want to keep" picks across the rolling 10-revision
     * window.
     */
    pinned: db.default(z.boolean(), false),
  }),
  indexes: [
    /**
     * Read path: list revisions for a folio, newest first.
     */
    { columns: ["folioId", "at"] },
    /**
     * The activity feed's window scan
     * (`ProjectActivityService.folioEvents`), which filters on `at` alone
     * and joins the folio afterwards to scope it to a project.
     *
     * The index above cannot serve that: `folioId` leads and the predicate
     * constrains nothing on it, so the feed read every one of production's
     * 998 revisions. Expensive out of proportion to the output, because
     * this table carries `contentSnapshot` - a full copy of the folio body
     * per save, ~8.8 KB a row and roughly 30% of the whole database.
     */
    { columns: ["at"] },
  ],
});

export type FolioRevision = Infer<typeof folioRevisions.schema>;
