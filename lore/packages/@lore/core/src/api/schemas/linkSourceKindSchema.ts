import { type Infer, z } from "alepha";

/**
 * What can CONTAIN a `[[...]]` reference — the source side of
 * `folio_links`.
 *
 * Deliberately its own enum rather than {@link elementKindSchema} plus a
 * literal. A **comment is not an element**: it has no title and hangs off
 * an element rather than being one, so folding it into the element union
 * would either bar comments from linking or make "element" mean something
 * it does not. The two unions overlap today and are free to diverge, which
 * is the point.
 *
 * `comment` is listed before comments exist. That is cheap — the column is
 * `mode: "text"`, so the enum is code-only — and it is the whole reason
 * this schema is separate: writing it now costs nothing, whereas widening
 * a discriminator whose literals are already persisted is a data
 * migration.
 *
 * `persona` and `requirement` (#E153) are the sources of two mirror
 * relations, `actor` (a persona plays a use case) and `source` (a requirement
 * comes from a folio): rows written by `@lore/plan-requirements` after its
 * own tables, never parsed out of a body.
 *
 * Distinct again from {@link linkTargetKindSchema}, which adds `feedback`
 * and `release`: both can be pointed at but contain nothing, so they are targets and never
 * a source.
 */
export const linkSourceKindSchema = z.enum([
  "folio",
  "quest",
  "epic",
  "comment",
  "persona",
  "requirement",
]);

export type LinkSourceKind = Infer<typeof linkSourceKindSchema>;
