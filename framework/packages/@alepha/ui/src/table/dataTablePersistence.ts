import { type ZObject, z } from "alepha";

import type {
  DataTableFilterMode,
  ColumnDef,
  SortState,
} from "./dataTableTypes.ts";

/**
 * Where a table keeps what it persists: the filters, the filters on the bar,
 * the columns and their order, the sort, the page size and the summary
 * panel, each under its `persistenceKey` and a suffix naming the facet.
 *
 * Synchronous on both sides, and that is the contract: the table reads its
 * state in `useState` initializers, so a store reached over the network has
 * to be loaded before the table mounts and answer from memory after that.
 * `write` with `undefined` deletes the value; `writePersisted` turns an empty
 * object or array into `undefined` before it gets here.
 *
 * The default is {@link localStorageDataTableStorage}. Pass another one as a
 * table's `persistenceStorage` to keep its state somewhere else, a user's
 * preferences on the server for one. It should keep one identity for the
 * table's lifetime: it is read when the table mounts and when its
 * `persistenceKey` changes, not when the storage does.
 */
export interface DataTablePersistenceStorage {
  /**
   * The value stored for one facet of one key, or `undefined` when there is
   * none. Never throws.
   */
  read(key: string, suffix: string): unknown;
  /**
   * Store one facet of one key; `undefined` deletes it. Never throws.
   */
  write(key: string, suffix: string, value: unknown): void;
}

/**
 * Every suffix a DataTable stores under its `persistenceKey`, one per facet.
 * What a storage moving a table's state from one place to another (say, from
 * `localStorage` to a server) has to carry over.
 */
export const DATA_TABLE_PERSISTED_SUFFIXES = [
  "filters",
  "filterVisibility",
  "columns",
  "columnOrder",
  "sort",
  "size",
  "summaryOpen",
] as const;

/**
 * The default storage: `localStorage`, under `<key>.<suffix>`, as JSON.
 * Answers nothing on the server, and skips a write the browser refuses
 * (private mode, quota).
 */
export const localStorageDataTableStorage: DataTablePersistenceStorage = {
  read: (key, suffix) => {
    if (typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(`${key}.${suffix}`);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  write: (key, suffix, value) => {
    if (typeof window === "undefined") return;
    const fullKey = `${key}.${suffix}`;
    try {
      if (value === undefined) {
        window.localStorage.removeItem(fullKey);
        return;
      }
      window.localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // localStorage may be unavailable (private mode, quota). Skip.
    }
  },
};

/**
 * Synchronous read of `<key>.<suffix>` from `storage`, `localStorage` by
 * default. Returns undefined on miss or error, and on the server.
 */
export const readPersisted = <V>(
  key: string,
  suffix: string,
  storage: DataTablePersistenceStorage = localStorageDataTableStorage,
): V | undefined => {
  try {
    const value = storage.read(key, suffix);
    return value === undefined || value === null ? undefined : (value as V);
  } catch {
    return undefined;
  }
};

/**
 * Reshape persisted filter values that no longer match the schema.
 *
 * Filters are stored per `persistenceKey` (in localStorage by default), so a filter whose
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
 * Synchronous write of `<key>.<suffix>` to `storage`, `localStorage` by
 * default. Empty objects, empty arrays and null delete the key.
 */
export const writePersisted = (
  key: string,
  suffix: string,
  value: unknown,
  storage: DataTablePersistenceStorage = localStorageDataTableStorage,
): void => {
  const isEmptyObject =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0;
  const isEmptyArray = Array.isArray(value) && value.length === 0;
  const empty =
    value === undefined || value === null || isEmptyObject || isEmptyArray;
  try {
    storage.write(key, suffix, empty ? undefined : value);
  } catch {
    // A storage that throws loses the write, never the table.
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
  storage?: DataTablePersistenceStorage,
): SortState | null => {
  const stored = key
    ? readPersisted<SortState>(key, "sort", storage)
    : undefined;
  return stored ?? fallback ?? null;
};

export const persistedSize = (
  key: string | undefined,
  fallback: number | undefined,
  storage?: DataTablePersistenceStorage,
): number => {
  const stored = key ? readPersisted<number>(key, "size", storage) : undefined;
  return stored ?? fallback ?? 20;
};

/**
 * Whether the summary panel is open: the reader's last choice, or open.
 *
 * Stored with the key whatever `persist` says, like the page size: it is how
 * the reader arranged the page, not a question they asked it.
 */
export const persistedSummaryOpen = (
  key: string | undefined,
  storage?: DataTablePersistenceStorage,
): boolean => {
  const stored = key
    ? readPersisted<unknown>(key, "summaryOpen", storage)
    : undefined;
  return typeof stored === "boolean" ? stored : true;
};

export const persistedColumns = <T>(
  key: string | undefined,
  columns: Record<string, ColumnDef<T>>,
  storage?: DataTablePersistenceStorage,
): Set<string> => {
  const declared = new Set(
    Object.keys(columns).filter((k) => !columns[k]!.defaultHidden),
  );
  const stored = key
    ? readPersisted<string[]>(key, "columns", storage)
    : undefined;
  if (!Array.isArray(stored)) return declared;
  const kept = new Set(stored.filter((k) => k in columns));
  // A stored set that names none of today's columns is a snapshot of an
  // older layout, not a reader's choice: a table showing zero columns is not
  // something anyone picks (the picker keeps the last one). It
  // used to win anyway, so a table whose columns were all renamed opened as
  // rows of empty cells, headers included, for everyone who had once toggled
  // a column. The declaration wins instead.
  return kept.size > 0 ? kept : declared;
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
  storage?: DataTablePersistenceStorage,
): string[] =>
  reconcileOrder(
    key ? readPersisted<string[]>(key, "columnOrder", storage) : undefined,
    Object.keys(columns),
  );

/**
 * Which filters a reader changed on the bar against the declaration: the
 * optional ones they added, and the default ones they removed.
 */
export interface PersistedFilterVisibility {
  added: string[];
  removed: string[];
}

/**
 * The filters a table puts on the bar from the start: every `default` field.
 * A locked field is drawn regardless, and is not part of the set.
 */
export const declaredShownFilters = (
  modes: Record<string, DataTableFilterMode>,
): string[] => Object.keys(modes).filter((key) => modes[key] === "default");

/**
 * The filters on the bar for one scope: the declaration, with the reader's
 * stored change applied to it.
 *
 * Stored as a CHANGE rather than as a list, for the reason `reconcileOrder`
 * gives for columns: a list is a snapshot of the fields as they were, and a
 * `default` field added in a later release is missing from it, so a stored
 * list would hide the very filter that release meant to show. Reconciled on
 * read: a key no longer declared is dropped, an added key that is no longer
 * optional and a removed key that is no longer default do nothing, and a
 * locked key ignores both.
 */
export const persistedShownFilters = (
  key: string | undefined,
  modes: Record<string, DataTableFilterMode>,
  storage?: DataTablePersistenceStorage,
): string[] => {
  const declared = declaredShownFilters(modes);
  const stored = key
    ? readPersisted<Partial<PersistedFilterVisibility>>(
        key,
        "filterVisibility",
        storage,
      )
    : undefined;
  if (!stored) return declared;
  const listOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const removed = new Set(
    listOf(stored.removed).filter((k) => modes[k] === "default"),
  );
  const added = listOf(stored.added).filter((k) => modes[k] === "optional");
  return [...declared.filter((k) => !removed.has(k)), ...added];
};

/**
 * The change a set of shown filters makes against the declaration, or
 * `undefined` when it makes none, which `writePersisted` turns into a delete.
 */
export const filterVisibilityChange = (
  shown: readonly string[],
  modes: Record<string, DataTableFilterMode>,
): PersistedFilterVisibility | undefined => {
  const added = shown.filter((k) => modes[k] === "optional");
  const removed = declaredShownFilters(modes).filter((k) => !shown.includes(k));
  return added.length === 0 && removed.length === 0
    ? undefined
    : { added, removed };
};
