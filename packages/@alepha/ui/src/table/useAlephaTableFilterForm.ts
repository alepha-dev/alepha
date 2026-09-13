import { type Alepha, type ZObject, z } from "alepha";
import { useForm } from "alepha/react/form";
import { useMemo } from "react";

import type { AlephaTableBaseProps } from "./alephaTableBaseProps.ts";
import {
  readPersisted,
  reconcilePersistedFilters,
} from "./alephaTablePersistence.ts";
import type { AlephaTableSource } from "./alephaTableTypes.ts";
import { queryToFilters } from "./queryFilters.ts";

const EMPTY_FILTERS_SCHEMA = z.object({}) as ZObject;

export interface UseAlephaTableFilterFormOptions<T> {
  props: AlephaTableBaseProps<T> & AlephaTableSource<T>;
  /**
   * The key the filter values are persisted under, or `undefined` when the
   * table does not store them.
   */
  filtersKey: string | undefined;
  alepha: Alepha;
}

/**
 * The filter form `AlephaTable` reads its filter values from: its own
 * `useForm` when `filters` is set, the caller's legacy `form` otherwise.
 */
export const useAlephaTableFilterForm = <T>(
  options: UseAlephaTableFilterFormOptions<T>,
) => {
  const { props, filtersKey, alepha } = options;

  // -- Filter form (internal when `filters` is set, else legacy `form`) -----

  // Read persisted filter values synchronously so they reach useForm's
  // first invocation. Reading inside an effect would be too late —
  // useForm captures `initialValues` only once via useMemo.
  const persistedFilterValues = useMemo(() => {
    if (!filtersKey || !props.filters) return undefined;
    return reconcilePersistedFilters(
      props.filters.schema,
      readPersisted<Record<string, any>>(filtersKey, "filters"),
    );
  }, [filtersKey, props.filters]);

  /**
   * Filter values the URL carries, when the caller opted in with `fromQuery`.
   *
   * Read from the store rather than through `useRouterState`, on purpose:
   * this is a one-shot read at mount, so the subscription would only buy a
   * re-render of the whole table on navigations it must not react to anyway.
   * A missing store (a table mounted with no router at all) reads as no
   * query, not as a crash.
   */
  const queryFilterValues = useMemo(() => {
    const fromQuery = props.filters?.fromQuery;
    if (!fromQuery || !props.filters) return undefined;
    const query = (
      alepha.store.get("alepha.react.router.state") as
        | { query?: Record<string, any> }
        | undefined
    )?.query;
    if (!query) return undefined;
    return queryToFilters(
      alepha,
      props.filters.schema,
      query,
      Array.isArray(fromQuery) ? fromQuery : undefined,
    );
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
  // doesn't pass `filters`, the internal form has an empty schema and
  // is simply unused.
  const internalForm = useForm({
    schema: props.filters?.schema ?? EMPTY_FILTERS_SCHEMA,
    initialValues: mergedFilterInitialValues,
    handler: async () => {
      // No-op — the table subscribes to `form:submit:success` to refetch.
    },
  });

  const form = props.filters ? internalForm : props.form;

  return form;
};
