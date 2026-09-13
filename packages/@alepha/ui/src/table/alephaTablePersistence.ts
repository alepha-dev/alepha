import { type ZObject, z } from "alepha";

import type { ColumnDef, SortState } from "./alephaTableTypes.ts";

/**
 * Synchronous localStorage read. Returns undefined on miss or error.
 */
export const readPersisted = <V>(
  key: string,
  suffix: string,
): V | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${key}.${suffix}`);
    return raw == null ? undefined : (JSON.parse(raw) as V);
  } catch {
    return undefined;
  }
};

/**
 * Reshape persisted filter values that no longer match the schema.
 *
 * Filters are stored in localStorage per `persistenceKey`, so a filter whose
 * shape changes meets values written by the previous shape - on the machine
 * of anyone who has used the page, and only there, which is precisely the
 * class of bug no test environment contains. The first case was the Quests
 * table going from one value per filter to many (quest #1644): a stored
 * `area: "lore/feedback"` reaching an array field.
 *
 * A scalar where the schema now wants an array is WRAPPED, not dropped: the
 * reader's filter survives the change, which is what makes the migration
 * invisible. The reverse takes the first element, since there is no honest
 * way to keep the rest. Anything else is left alone - this reconciles a
 * container, not a value, and the form's own validation still has the last
 * word.
 */
export const reconcilePersistedFilters = (
  schema: ZObject | undefined,
  values: Record<string, any> | undefined,
): Record<string, any> | undefined => {
  if (!schema || !values) return values;
  const shape = z.schema.shape(schema);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = shape[key];
    if (!field) {
      // A filter that no longer exists. Dropped rather than passed through,
      // so a removed field cannot reappear in the fetch payload.
      continue;
    }
    const wantsArray = z.schema.isArray(z.schema.unwrap(field));
    const isArray = Array.isArray(value);
    if (wantsArray && !isArray) {
      out[key] = value === undefined || value === "" ? [] : [value];
    } else if (!wantsArray && isArray) {
      out[key] = value[0];
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Synchronous localStorage write. Empty objects/null delete the key.
 */
export const writePersisted = (
  key: string,
  suffix: string,
  value: unknown,
): void => {
  if (typeof window === "undefined") return;
  const fullKey = `${key}.${suffix}`;
  try {
    const isEmptyObject =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0;
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    if (
      value === undefined ||
      value === null ||
      isEmptyObject ||
      isEmptyArray
    ) {
      window.localStorage.removeItem(fullKey);
      return;
    }
    window.localStorage.setItem(fullKey, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, quota). Skip.
  }
};

/**
 * The three persisted preferences, read for one `persistenceKey`.
 *
 * Factored out because they are read from TWO places now: once at mount, and
 * again whenever the key changes under a mounted table. Inline in `useState`
 * they could only be read once, and a second copy of each rule is how the
 * scope-change path would come to disagree with the mount path about what a
 * stored value means.
 */
export const persistedSort = (
  key: string | undefined,
  fallback: SortState | null | undefined,
): SortState | null => {
  const stored = key ? readPersisted<SortState>(key, "sort") : undefined;
  return stored ?? fallback ?? null;
};

export const persistedSize = (
  key: string | undefined,
  fallback: number | undefined,
): number => {
  const stored = key ? readPersisted<number>(key, "size") : undefined;
  return stored ?? fallback ?? 20;
};

export const persistedColumns = <T>(
  key: string | undefined,
  columns: Record<string, ColumnDef<T>>,
): Set<string> => {
  const stored = key ? readPersisted<string[]>(key, "columns") : undefined;
  if (stored) {
    return new Set(stored.filter((k) => k in columns));
  }
  return new Set(
    Object.keys(columns).filter((k) => !columns[k]!.defaultHidden),
  );
};

/**
 * The reader's column order, reconciled against what the table actually
 * declares.
 *
 * Reconciliation is the whole of this function and the reason it is not just
 * `readPersisted`. A stored array is a snapshot of the columns as they were
 * when somebody last dragged one, and the code has moved since: a column
 * added in a later release is missing from it, one removed is still in it.
 * Trusting it verbatim would drop the new column from the table entirely and
 * try to render a dead one.
 *
 * New keys go to the END rather than at their declared index. That is the
 * rule with the least surprise: the reader's layout is left exactly as they
 * arranged it, and the new column turns up somewhere predictable where the
 * picker can find it. Splicing it in by declaration index would put it at a
 * position matching neither the author's intent (the rest of the order is not
 * the declared one any more) nor the reader's.
 */
export const reconcileOrder = (
  stored: string[] | undefined,
  declared: string[],
): string[] => {
  if (!stored) return declared;
  const known = new Set(declared);
  const kept = stored.filter((key) => known.has(key));
  const seen = new Set(kept);
  return [...kept, ...declared.filter((key) => !seen.has(key))];
};

export const persistedOrder = <T>(
  key: string | undefined,
  columns: Record<string, ColumnDef<T>>,
): string[] =>
  reconcileOrder(
    key ? readPersisted<string[]>(key, "columnOrder") : undefined,
    Object.keys(columns),
  );
