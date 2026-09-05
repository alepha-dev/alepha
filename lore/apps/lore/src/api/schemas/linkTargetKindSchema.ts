import { type Infer, z } from "alepha";

/**
 * What a `[[...]]` reference can point AT: any element (folio, quest,
 * epic), plus `feedback` and `release`, which have a per-project number and
 * a title but no body of their own to link FROM, plus `blob`, a binary
 * attachment.
 *
 * A superset of {@link elementKindSchema} on purpose. A blob has bytes and
 * a name but no body, so nothing inside it can reference anything — it is a
 * target and never a source. Keeping the two unions apart is what stops a
 * future "sync this element's links" call from being handed a blob.
 *
 * Persisted as `folio_links.target_type`, which is `mode: "text"` — no
 * CHECK constraint at the database level, so extending this enum is a
 * code-only change with no migration. That is exactly how `epic` was added,
 * and how `feedback` and `release` were (epic #32). The literals ARE the
 * stored values: renaming one is a data migration, not a rename, which is
 * why the kind is `feedback` and not the `petition` its letter `P` recalls.
 */
export const linkTargetKindSchema = z.enum([
  "folio",
  "quest",
  "epic",
  "blob",
  "feedback",
  "release",
]);

export type LinkTargetKind = Infer<typeof linkTargetKindSchema>;
