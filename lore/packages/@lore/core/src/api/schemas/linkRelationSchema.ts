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
 */
export const linkRelationSchema = z.enum(["filed"]);

export type LinkRelation = Infer<typeof linkRelationSchema>;
