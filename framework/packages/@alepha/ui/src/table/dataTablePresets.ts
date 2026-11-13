/**
 * Whether a filter value selects nothing: absent, empty text or an empty
 * list. The filter form holds all three for "no filter", so a preset compares
 * them as one.
 */
export const isEmptyFilterValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/**
 * Whether two filter values select the same rows. Lists compare as sets, so
 * `["todo", "in_progress"]` equals `["in_progress", "todo"]`; a single value
 * equals the one-item list holding it, since a link's `?status=todo` decodes
 * to either depending on the field's schema.
 */
export const sameFilterValue = (a: unknown, b: unknown): boolean => {
  const emptyA = isEmptyFilterValue(a);
  const emptyB = isEmptyFilterValue(b);
  if (emptyA || emptyB) return emptyA && emptyB;
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [a].flat().map(asText).sort();
    const right = [b].flat().map(asText).sort();
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
  return asText(a) === asText(b);
};

/**
 * A value as comparable text: a string as it is, anything else (a number
 * from a URL decoded by its schema, a date range) as its JSON, so `"7"` and
 * `7` compare equal and an object is compared by content.
 */
const asText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/**
 * Whether the table's filter values are exactly a preset's: every filter key
 * compared, so a filter the preset does not name must be empty.
 */
export const presetMatches = (
  values: Record<string, unknown>,
  presetValues: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  keys.every((key) => sameFilterValue(values[key], presetValues[key]));

/**
 * Whether no filter is set at all: what lights "All".
 */
export const noFilterSet = (
  values: Record<string, unknown>,
  keys: readonly string[],
): boolean => keys.every((key) => isEmptyFilterValue(values[key]));
