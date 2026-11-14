import { type Alepha, type ZObject, z } from "alepha";
import { type FormModel, useForm } from "alepha/react/form";
import { useEffect, useMemo, useRef } from "react";

import type { DataTableBaseProps } from "./dataTableBaseProps.ts";
import {
  dataTableFilterKeys,
  dataTableFilterMode,
  dataTableFilterOperatorKey,
  buildDataTableFilterSchema,
} from "./dataTableFilterFields.ts";
import {
  readPersisted,
  reconcilePersistedFilters,
} from "./dataTablePersistence.ts";
import { isEmptyFilterValue } from "./dataTablePresets.ts";
import {
  DATA_TABLE_FILTERS_QUERY_KEY,
  DATA_TABLE_NO_STORED_FILTERS,
} from "./dataTableQueryKeys.ts";
import type {
  DataTableFilterFields,
  DataTableFilterMode,
  DataTableSource,
} from "./dataTableTypes.ts";
import { queryToFilters } from "./queryFilters.ts";

const EMPTY_FILTERS_SCHEMA = z.object({}) as ZObject;

export interface UseDataTableFilterFormOptions<T> {
  props: DataTableBaseProps<T, DataTableFilterFields> &
    DataTableSource<T, DataTableFilterFields>;
  /**
   * The key the filter values are persisted under, or `undefined` when the
   * table does not store them.
   */
  filtersKey: string | undefined;
  alepha: Alepha;
}

/**
 * What a table's filters are, as read at mount: the schema its form is built
 * on, every key a filter value is stored under, and the mode each field
 * starts in.
 */
export interface DataTableFilterDefinition {
  schema: ZObject;
  /**
   * Every filter key, operator keys included, in declaration order. See
   * `dataTableFilterKeys`.
   */
  keys: string[];
  /**
   * The mode of each field, keyed by field.
   */
  modes: Record<string, DataTableFilterMode>;
}

/**
 * The filter form `DataTable` reads its filter values from, and the
 * definition it was built from. Both are `undefined` without `filters`.
 */
export const useDataTableFilterForm = <T>(
  options: UseDataTableFilterFormOptions<T>,
): {
  form: FormModel<ZObject> | undefined;
  definition: DataTableFilterDefinition | undefined;
} => {
  const { props, filtersKey, alepha } = options;

  /**
   * The schema, the keys and the modes, read ONCE.
   *
   * `useForm` captures its schema at mount and persistence and `fromQuery`
   * are read at mount, so a key set that moved later would be a filter the
   * form cannot hold.
   */
  const definition = useMemo<DataTableFilterDefinition | undefined>(() => {
    const fields = props.filters?.fields;
    if (!fields) return undefined;
    const modes: Record<string, DataTableFilterMode> = {};
    for (const [key, field] of Object.entries(fields)) {
      modes[key] = dataTableFilterMode(field);
    }
    return {
      schema: buildDataTableFilterSchema(fields),
      keys: dataTableFilterKeys(fields),
      modes,
    };
  }, []);

  /**
   * A key set that changed after mount does nothing: the form, persistence
   * and the URL all read the one taken at mount. Silence would leave a filter
   * that never filters, so development says so, once. A field that has
   * nothing to offer yet sets `hidden` instead of dropping its key.
   */
  const warnedKeys = useRef(false);
  useEffect(() => {
    const fields = props.filters?.fields;
    if (!fields || !definition || warnedKeys.current) return;
    if (alepha.isProduction()) return;
    const keys = dataTableFilterKeys(fields);
    if (keys.join(",") === definition.keys.join(",")) return;
    warnedKeys.current = true;
    console.warn(
      `DataTable: the filter fields changed after mount (${definition.keys.join(", ")} -> ${keys.join(", ")}). ` +
        "The key set is read once; set `hidden` on a field instead of dropping its key, or change the table's `key` to remount it.",
    );
  });

  // Read persisted filter values synchronously so they reach useForm's
  // first invocation. Reading inside an effect would be too late —
  // useForm captures `initialValues` only once via useMemo.
  const persistedFilterValues = useMemo(() => {
    if (!filtersKey || !definition) return undefined;
    return reconcilePersistedFilters(
      definition.schema,
      readPersisted<Record<string, any>>(filtersKey, "filters"),
    );
  }, [filtersKey, definition]);

  /**
   * Filter values the URL carries, when the caller opted in with `fromQuery`.
   *
   * Read from the store rather than through `useRouterState`, on purpose:
   * this is a one-shot read at mount, so the subscription would only buy a
   * re-render of the whole table on navigations it must not react to anyway.
   * A missing store (a table mounted with no router at all) reads as no
   * query, not as a crash.
   *
   * An allowlist that names a field brings its operator key with it: a link
   * carrying `?status=done&statusOp=not`, read without the operator, would
   * select the very rows it excluded.
   */
  const routerQuery = useMemo(() => {
    if (!props.filters?.fromQuery || !definition) return undefined;
    return (
      alepha.store.get("alepha.react.router.state") as
        | { query?: Record<string, any> }
        | undefined
    )?.query;
  }, []);

  /**
   * `?filters=none` (`DATA_TABLE_NO_STORED_FILTERS`): the link's filters are
   * the whole filter even when it carries none. A drill-through to an
   * unfiltered list (a dashboard's "every user" tile) has no filter of its
   * own to replace the stored ones with, so without this the reader's
   * filters from last week would narrow the list the link promised. Read
   * only when the table opted into `fromQuery`, like every other param.
   */
  const ignoreStored =
    routerQuery?.[DATA_TABLE_FILTERS_QUERY_KEY] ===
    DATA_TABLE_NO_STORED_FILTERS;

  const queryFilterValues = useMemo(() => {
    const fromQuery = props.filters?.fromQuery;
    if (!fromQuery || !definition) return undefined;
    const query = routerQuery;
    if (!query) return undefined;
    let keys: readonly string[] = definition.keys;
    const fields = props.filters?.fields;
    if (Array.isArray(fromQuery) && fields) {
      keys = fromQuery.flatMap((key) => {
        const field = fields[key];
        const operatorKey = field
          ? dataTableFilterOperatorKey(key, field)
          : undefined;
        return operatorKey && !fromQuery.includes(operatorKey)
          ? [key, operatorKey]
          : [key];
      });
    }
    return queryToFilters(alepha, definition.schema, query, keys);
  }, []);

  const mergedFilterInitialValues = useMemo<Record<string, any>>(
    () => ({
      ...props.filters?.initialValues,
      // A link that carries filters REPLACES the stored choice rather than
      // adding to it: a drill-through or a preset's values arriving by URL
      // mean those rows, and a filter the reader set last week kept on top
      // of them would silently narrow the list the link promised.
      ...(ignoreStored || hasQueryFilters(queryFilterValues)
        ? {}
        : persistedFilterValues),
      ...queryFilterValues,
      // Last: an explicit `seedValues` is the caller deciding for a case of
      // its own, and outranks what the URL happened to carry.
      ...props.filters?.seedValues,
    }),
    [],
  );

  // Always call useForm to keep hook order stable. When the caller
  // doesn't pass `filters`, the form has an empty schema and is unused.
  const internalForm = useForm({
    schema: definition?.schema ?? EMPTY_FILTERS_SCHEMA,
    initialValues: mergedFilterInitialValues,
    handler: async () => {
      // No-op — the table subscribes to `form:submit:success` to refetch.
    },
  });

  return { form: definition ? internalForm : undefined, definition };
};

const hasQueryFilters = (values: Record<string, unknown> | undefined) =>
  Boolean(values) &&
  Object.values(values as Record<string, unknown>).some(
    (value) => !isEmptyFilterValue(value),
  );
