/**
 * HTTP method → colour token.
 *
 * One table for the whole UI: the action tree, the action detail header and
 * the authorization matrix all render the same verb, and three copies of this
 * map is three chances for GET to be green in one place and blue in another.
 */
export const METHOD_COLOR: Record<string, string> = {
  GET: "var(--dt-get)",
  POST: "var(--dt-post)",
  PUT: "var(--dt-put)",
  PATCH: "var(--dt-patch)",
  DELETE: "var(--dt-delete)",
};

export const methodColor = (method: string): string | undefined =>
  METHOD_COLOR[method.toUpperCase()];

/**
 * `DELETE` abbreviated to `DEL`.
 *
 * Every other verb fits in three or four characters; letting one of them set
 * the column width costs three characters on every row of every table that
 * shows a method.
 */
export const shortMethod = (method: string): string => {
  const upper = method.toUpperCase();
  return upper === "DELETE" ? "DEL" : upper;
};
