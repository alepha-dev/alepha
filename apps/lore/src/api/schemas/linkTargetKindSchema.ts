import { type Infer, z } from "alepha";

/**
 * What a `[[#Q12]]` reference can point AT: any element (folio, quest,
 * epic), plus `feedback` and `release`, which have a per-project number and
 * a title but no body of their own to link FROM. One literal per letter of
 * the grammar: `F`, `Q`, `E`, `P`, `R`.
 *
 * A superset of {@link elementKindSchema} on purpose: feedback and releases
 * are targets and never sources. Keeping the two unions apart is what stops
 * a future "sync this element's links" call from being handed one.
 *
 * Persisted as `folio_links.target_type`, which is `mode: "text"` — no
 * CHECK constraint at the database level, so extending this enum is a
 * code-only change with no migration. That is exactly how `epic` was added,
 * and how `feedback` and `release` were (epic #32). The literals ARE the
 * stored values: renaming one is a data migration, not a rename, which is
 * why the kind is `feedback` and not the `petition` its letter `P` recalls.
 * Removing one is a data migration too: `blob` left with the purge of epic
 * #32, after the converter had deleted every row carrying it, because a
 * stored value the enum no longer has fails validation on read.
 */
export const linkTargetKindSchema = z.enum([
  "folio",
  "quest",
  "epic",
  "feedback",
  "release",
]);

export type LinkTargetKind = Infer<typeof linkTargetKindSchema>;
