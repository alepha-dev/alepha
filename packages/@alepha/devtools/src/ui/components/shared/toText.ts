/**
 * Render an arbitrary value as display text.
 *
 * Everything DevTools shows comes from somewhere it does not control: a
 * database column, an env var, an atom, a schema default. `String(value)` on
 * an object renders `[object Object]`, which in a table cell or an env line is
 * indistinguishable from a value that really says that. JSON is the only
 * honest answer for a structured value, and it is also the one a developer
 * looking at DevTools wants.
 *
 * `null` and `undefined` render empty rather than as the words "null" and
 * "undefined": a cell that says `null` reads as the four-character string.
 * Callers that need to distinguish them (the NULL badge in `RowCell`) test
 * before calling.
 */
export const toText = (value: unknown): string => {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Cyclic, or a BigInt in the graph. Better a partial answer than a throw
      // in the middle of rendering a table.
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
};
