import { type Infer, z } from "alepha";

/**
 * Why a `folio_links` row exists, beside a mention.
 *
 * A row with no relation is a MENTION: a `[[#F12]]` parsed out of the
 * source's body, deleted and rewritten on every save of that body. A row
 * with a relation is an explicit act that no body holds, and a body save
 * never touches it:
 *
 * - `filed`: the source files the target, as an epic files its folios
 *   (#Q2626). A folio does not know which epic it is filed under (folio
 *   #F1356, decision 8): the filing lives in core's link graph.
 *
 * Three more, from Plan's Requirements (#E153), each a MIRROR of a table of
 * `@lore/plan-requirements` that holds the edge's attributes: the table is
 * the truth and is written first, the row after it, best effort, and
 * rewritten on every save of its source so a lost row heals.
 *
 * - `actor`: a persona plays a use case (`use_case_actors` holds the role);
 * - `covers`: an epic covers a use case (no attribute: the row is the store);
 * - `source`: a requirement comes from a folio (the requirement holds the
 *   heading anchor and the revision it was synced to).
 *
 * `verifies` is not a relation: a criterion is not a link kind, and
 * `criteria.requirementId` holds that edge.
 */
export const linkRelationSchema = z.enum([
  "filed",
  "actor",
  "covers",
  "source",
]);

export type LinkRelation = Infer<typeof linkRelationSchema>;
