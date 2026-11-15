/**
 * A filter's value as the text of a box: empty for nothing, the value itself
 * for a string or a number.
 */
export const dataTableFilterText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
