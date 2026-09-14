import { type Alepha, type ZObject, z } from "alepha";
import { type FormModel, useForm } from "alepha/react/form";
import { useEffect, useMemo, useRef } from "react";

import type { AlephaTableBaseProps } from "./alephaTableBaseProps.ts";
import {
  alephaTableFilterKeys,
  alephaTableFilterMode,
  alephaTableFilterOperatorKey,
  buildAlephaTableFilterSchema,
} from "./alephaTableFilterFields.ts";
import {
  readPersisted,
  reconcilePersistedFilters,
} from "./alephaTablePersistence.ts";
import type {
  AlephaTableFilterFields,
  AlephaTableFilterMode,
  AlephaTableSource,
} from "./alephaTableTypes.ts";
import { queryToFilters } from "./queryFilters.ts";

const EMPTY_FILTERS_SCHEMA = z.object({}) as ZObject;

export interface UseAlephaTableFilterFormOptions<T> {
  props: AlephaTableBaseProps<T, AlephaTableFilterFields> &
    AlephaTableSource<T, AlephaTableFilterFields>;
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
export interface AlephaTableFilterDefinition {
  schema: ZObject;
  /**
   * Every filter key, operator keys included, in declaration order. See
   * `alephaTableFilterKeys`.
   */
  keys: string[];
  /**
   * The mode of each field, keyed by field.
   */
  modes: Record<string, AlephaTableFilterMode>;
}

/**
 * The filter form `AlephaTable` reads its filter values from, and the
 * definition it was built from. Both are `undefined` without `filters`.
 */
export const useAlephaTableFilterForm = <T>(
  options: UseAlephaTableFilterFormOptions<T>,
): {
  form: FormModel<ZObject> | undefined;
  definition: AlephaTableFilterDefinition | undefined;
} => {
  const { props, filtersKey, alepha } = options;

  /**
   * The schema, the keys and the modes, read ONCE.
   *
   * `useForm` captures its schema at mount and persistence and `fromQuery`
   * are read at mount, so a key set that moved later would be a filter the
   * form cannot hold.
   */
  const definition = useMemo<AlephaTableFilterDefinition | undefined>(() => {
    const fields = props.filters?.fields;
    if (!fields) return undefined;
    const modes: Record<string, AlephaTableFilterMode> = {};
    for (const [key, field] of Object.entries(fields)) {
      modes[key] = alephaTableFilterMode(field);
    }
    return {
      schema: buildAlephaTableFilterSchema(fields),
      keys: alephaTableFilterKeys(fields),
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
    const keys = alephaTableFilterKeys(fields);
    if (keys.join(",") === definition.keys.join(",")) return;
    warnedKeys.current = true;
    console.warn(
      `AlephaTable: the filter fields changed after mount (${definition.keys.join(", ")} -> ${keys.join(", ")}). ` +
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
  const queryFilterValues = useMemo(() => {
    const fromQuery = props.filters?.fromQuery;
    if (!fromQuery || !definition) return undefined;
    const query = (
      alepha.store.get("alepha.react.router.state") as
        | { query?: Record<string, any> }
        | undefined
    )?.query;
    if (!query) return undefined;
    let keys: readonly string[] = definition.keys;
    const fields = props.filters?.fields;
    if (Array.isArray(fromQuery) && fields) {
      keys = fromQuery.flatMap((key) => {
        const field = fields[key];
        const operatorKey = field
          ? alephaTableFilterOperatorKey(key, field)
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
      ...persistedFilterValues,
      // Above the stored choice — see `seedValues`. A drill-through link that
      // lost to a filter the reader set last week would be a link that does
      // nothing.
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
