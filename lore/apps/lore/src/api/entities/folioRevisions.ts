import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { folios } from "./folios.ts";

/**
 * Append-only revision log for folios — the folio's revision history.
 * One row per non-trivial mutation (edit / rename / revert).
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
     * Validated on read: a stored value missing from this enum fails to
     * decode and takes the whole history query with it (the 2026-08-05
     * class). Retiring a value is therefore a data migration first, as
     * `tag-change` was (#E74: its rows became `edit`).
     */
    action: z
      .enum(["create", "edit", "rename", "revert"])
      .meta({ mode: "text" }),
    /**
     * Snapshot of the folio's content at the time of the revision, or `""`
     * while {@link snapshotIsLive} says the live folio holds it.
     *
     * ⚠️ Never read this column directly: go through
     * `FolioHistoryService.contentOf`, which answers the live content for the
     * head revision.
     */
    contentSnapshot: z.string(),
    /**
     * The newest revision does not copy the body: it would be byte-identical
     * to `folios.content`, which is the row it documents (#Q2491: 603 rows,
     * 5 MB of production's 59 MB were exactly that). While this is true the
     * snapshot is `""` and the live content IS the snapshot.
     *
     * Kept true only for the head: every write that inserts or folds a
     * revision first fills in any other live row with the content the folio
     * held before that write (`FolioHistoryService.appendRevision`). That is
     * sound because the only three writers of `folios.content` (create,
     * update, revert in `FolioController`) all append a revision when the
     * body changes.
     *
     * An `ADD COLUMN` with a constant default, so no rebuild: this table is a
     * cascade child of `folios`, which is a cascade child of `projects`.
     */
    snapshotIsLive: db.default(z.boolean(), false),
    titleSnapshot: z.string(),
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
