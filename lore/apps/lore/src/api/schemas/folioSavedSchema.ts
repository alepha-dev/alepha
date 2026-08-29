import { z } from "alepha";

import { folios } from "../entities/folios.ts";

/**
 * What `create` and `update` answer with: the folio row, plus whether the
 * write changed that folio's REVISION LIST.
 *
 * A departure from the plain entity, and a deliberate one. `revisionsChanged`
 * is not a column and never will be — it describes what this one call DID,
 * not what the folio IS, which is exactly why it cannot be derived from the
 * returned row. The client has no other way to know: a save that folded into
 * the open revision and a save that opened a new one return byte-identical
 * folios.
 *
 * It is what stops `FolioHistoryTab` refetching the whole revision list — up
 * to ten FULL content snapshots — after every autosave. Autosave fires 1.5
 * seconds after typing stops and `FolioHistoryService`'s coalesce window is
 * an HOUR, so an ordinary writing session is one revision and was one list
 * request per pause.
 *
 * `true` covers both ways the list can change, not just the obvious one:
 *
 * - a new revision row was inserted (the coalesce window had closed, or the
 *   action was a `revert`, which never folds);
 * - the folio crossed the protection boundary, so `purgeRevisions` emptied
 *   the history. Rarer, and the reason this is not called `revisionCreated`:
 *   a purge with no accompanying insert changes the list to nothing at all,
 *   and a client keying on "was one created" would show a list of revisions
 *   that no longer exist.
 *
 * `false` means the write folded into the revision already at the head. That
 * row's `at` and snapshots did move, so a cached list is stale in its
 * relative timestamp and its line/word deltas — accepted, because the
 * alternative is a request per keystroke-pause for a panel showing "a few
 * seconds ago" either way.
 */
export const folioSavedSchema = folios.schema.extend({
  revisionsChanged: z.boolean(),
});
