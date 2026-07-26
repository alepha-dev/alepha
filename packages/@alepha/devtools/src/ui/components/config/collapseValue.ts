const MAX_KEYS = 2;

/**
 * A value rendered on one line.
 *
 * Atom values are compared far more often than they are read in full — "is it
 * still `dark`?", "did that mutation land?" — and a pretty-printed block pushes
 * everything below it off screen to answer a question you could answer from the
 * first two keys. The full value is a click away in the JSON editor.
 */
export const collapse = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return JSON.stringify(value) ?? String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[ ${value.length} item${value.length === 1 ? "" : "s"} ]`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";

  const shown = entries
    .slice(0, MAX_KEYS)
    .map(([k, v]) => `${k}: ${leaf(v)}`)
    .join(", ");

  return entries.length > MAX_KEYS ? `{ ${shown}, … }` : `{ ${shown} }`;
};

/**
 * One nested value, never recursing — a nested object is shown as `{…}` rather
 * than expanded, so the line length stays bounded whatever the shape.
 */
const leaf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return JSON.stringify(value) ?? String(value);
};
