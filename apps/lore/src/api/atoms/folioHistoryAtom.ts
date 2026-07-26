import { $atom, type Static, z } from "alepha";

/**
 * Retention policy for folio revisions. Kept as an atom so ops/tests
 * can override via `alepha.store.set(folioHistoryAtom, { ... })`
 * without touching code.
 *
 * Enforced inline by `FolioHistoryService` on every revision write —
 * when the count of non-pinned revisions for a folio would exceed the
 * cap after the insert, the oldest non-pinned revision is dropped in
 * the same transaction. No background sweep needed.
 */
export const folioHistoryAtom = $atom({
  name: "lore.folio.history",
  description: "Retention cap for folio revisions (Chronicles of the Folio).",
  schema: z.object({
    /**
     * Max revisions to keep per folio (excluding pinned revisions, which
     * are always preserved). 10 matches the spec; tunable.
     */
    maxRevisions: z.integer().min(1).default(10),
  }),
  default: {
    maxRevisions: 10,
  },
  serverOnly: true,
});

export type FolioHistoryOptions = Static<typeof folioHistoryAtom.schema>;
