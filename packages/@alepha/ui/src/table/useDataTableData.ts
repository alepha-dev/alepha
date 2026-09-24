import { type Alepha, type Page, type ZObject, z } from "alepha";
import { type FormModel, useForm } from "alepha/react/form";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DataTableBaseProps } from "./dataTableBaseProps.ts";
import { persistedSort, writePersisted } from "./dataTablePersistence.ts";
import type {
  DataTableFilterFields,
  DataTableSource,
  ColumnDef,
  SortState,
} from "./dataTableTypes.ts";
import { paginateLocal } from "./paginateLocal.ts";

export interface UseDataTableDataOptions<T> {
  props: DataTableBaseProps<T, DataTableFilterFields> &
    DataTableSource<T, DataTableFilterFields>;
  /**
   * The page size and its setter. The state is declared in `DataTable`,
   * first of all its hooks; this hook changes it from the footer's picker.
   */
  size: number;
  setSize: Dispatch<SetStateAction<number>>;
  /**
   * The key the sort is persisted under, or `undefined` when the table does
   * not store it.
   */
  sortKey: string | undefined;
  form: FormModel<ZObject> | undefined;
  alepha: Alepha;
}

/**
 * The rows `DataTable` renders and the state that picks them: the page, the
 * page-size picker, the sort, and either the fetched page or the static one
 * derived from `data`.
 *
 * The setters are returned alongside the values because the refresh wiring
 * and the scope change in `DataTable` write the same state.
 */
export const useDataTableData = <T>(options: UseDataTableDataOptions<T>) => {
  const { props, size, setSize, sortKey, form, alepha } = options;

  // -- Paging / sort / data --------------------------------------------------

  const [page, setPage] = useState(0);

  /**
   * Change the page size and go back to the first page.
   *
   * The reset is the whole point: raising the size while on page 5 can put
   * the reader past the last page, which renders an empty table with no
   * visible cause. Persisted so the choice survives a reload, alongside the
   * filters, sort and columns this table already remembers.
   */
  const changeSize = (next: number) => {
    setSize(next);
    setPage(0);
    if (props.persistenceKey) {
      writePersisted(props.persistenceKey, "size", next);
    }
  };

  /**
   * The footer's page-size picker, as a form of one field.
   *
   * `Control` is form-bound and this picker is not part of any form, which is
   * why the footer stayed on a raw `<Select>` long after everything else here
   * moved. One field is the whole cost of joining, and it buys the picker the
   * same trigger, popup and keyboard handling as every other select in the
   * table. `keepDirty: false` so the re-seed below actually re-seeds: `size`
   * can move without the picker (a persisted value on mount), and a kept
   * "edit" would pin the trigger to a page size the table is not using.
   */
  const sizeForm = useForm({
    schema: z.object({ size: z.number() }),
    initialValues: { size },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => changeSize(next as number),
  });

  const [sort, setSort] = useState<SortState | null>(() =>
    persistedSort(sortKey, props.defaultSort),
  );
  const [fetchedData, setData] = useState<T[]>([]);
  const [fetchedMeta, setMeta] = useState<Page<T>["page"] | null>(null);
  // The filters the fetched rows answer, copied when their request left:
  // `form.currentValues` is mutated in place and already holds what the
  // reader is typing now. Read by the cells through `rowFilters`.
  const [fetchedFilters, setFetchedFilters] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Alepha's pagination parser reads "field" as asc and "-field" as desc.
  // Multiple comma-separated entries are multi-column sort, so we must
  // NOT use `field,direction` syntax — that would treat "asc"/"desc" as
  // a second column name and 500 on the backend.
  const sortParam = sort
    ? sort.direction === "desc"
      ? `-${sort.field}`
      : sort.field
    : undefined;

  // Hold the latest `fetch` in a ref so it is NOT a dependency of `load`.
  // Callers pass `fetch` inline (a new function every render), and a fetcher
  // that writes a store atom the caller also subscribes to would otherwise
  // self-trigger: load → atom write → caller re-render → new `fetch` → new
  // `load` → effect re-runs → infinite loop. The ref keeps the newest closure
  // available while `load` only re-runs on actual inputs (page/size/sort/…).
  const fetchRef = useRef(props.fetch);
  fetchRef.current = props.fetch;

  // The newest request, so an older one that answers late cannot put its
  // rows back (#Q2517). A project switch, a filter keystroke or a refresh
  // each start one; only the last may write, and it aborts the one before.
  const latestRequest = useRef<
    { id: number; abort: AbortController } | undefined
  >(undefined);

  const load = useCallback(async () => {
    // Static mode owns no request. Bail before touching `loading` too, so a
    // table fed an array never flashes the skeleton over rows it already has.
    const fetcher = fetchRef.current;
    if (!fetcher) return;
    latestRequest.current?.abort.abort();
    const request = {
      id: (latestRequest.current?.id ?? 0) + 1,
      abort: new AbortController(),
    };
    latestRequest.current = request;
    const isLatest = () => latestRequest.current === request;
    setLoading(true);
    const sent = form ? { ...form.currentValues } : undefined;
    try {
      const res = await fetcher({
        page,
        size,
        sort: sortParam,
        filters: form?.currentValues,
        signal: request.abort.signal,
      });
      if (!isLatest()) return;
      setData(res.content);
      setMeta(res.page);
      setFetchedFilters(sent);
    } catch (error) {
      // A superseded request's failure (its own abort included) is nobody's
      // news: a newer one is already answering.
      if (!isLatest()) return;
      // Surface read failures through the same `react:action:error` channel
      // that useAction/useQuery use, so a mounted <ActionErrorToaster /> toasts
      // them. Keep the previous rows on screen rather than blanking the table.
      void alepha.events.emit("react:action:error", {
        type: "custom",
        id: "data-table:load",
        error: error as Error,
      });
    } finally {
      // Only the newest request clears `loading`: an older one finishing
      // first used to hide the spinner while the table still waited.
      if (isLatest()) {
        setLoading(false);
      }
    }
  }, [page, size, sortParam, refreshKey, form, alepha]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Static mode's equivalent of `load` — derived, not stored.
   *
   * Deliberately NOT routed through `load`: putting `props.data` in that
   * effect's dependencies reproduces the exact loop `fetchRef` exists to
   * prevent (load → setData → re-render → new inline array → new load).
   * Computed synchronously there is no state to go stale, an inline
   * `data={rows.filter(…)}` is safe, and a changed array is on screen in
   * the same render.
   */
  const staticPage = useMemo(() => {
    if (!props.data) return null;
    const sortValues: Record<string, (item: T) => unknown> = {};
    for (const [key, column] of Object.entries(props.columns)) {
      if (column.sortValue) {
        sortValues[column.sortKey ?? key] = column.sortValue;
      }
    }
    return paginateLocal(props.data, {
      page,
      size,
      sort: sortParam,
      sortValues,
      filters: form?.currentValues,
      filter: props.filter,
    });
    // `refreshKey` is what the filter-form subscriptions bump, so it is how
    // a filter change reaches this memo — `form.currentValues` is mutated in
    // place and its identity never changes.
  }, [
    props.data,
    props.columns,
    props.filter,
    page,
    size,
    sortParam,
    refreshKey,
    form,
  ]);

  const data = staticPage ? staticPage.content : fetchedData;
  const meta = staticPage ? staticPage.page : fetchedMeta;
  // Static rows are derived in this render from the current values, so those
  // ARE the filters they answer.
  const rowFilters = staticPage ? form?.currentValues : fetchedFilters;

  /**
   * Rows vanish under the reader in static mode: the caller detaches one and
   * the page they are on stops existing. Nothing fetches, so nothing else
   * would notice — the table would sit on an empty page with no visible
   * cause. Fetch mode has the same hole, but there the server round-trip
   * needed to see it makes this the wrong place to close it.
   */
  if (staticPage) {
    const totalPages = staticPage.page.totalPages ?? 0;
    if (page > 0 && page > totalPages - 1) {
      // Guarded on `page`, so it settles in one pass and does not need an
      // effect: the clamp lands before the rows render against a page that no
      // longer exists.
      setPage(Math.max(0, totalPages - 1));
    }
  }

  // Persist sort to localStorage on every change.
  useEffect(() => {
    if (!sortKey) return;
    writePersisted(sortKey, "sort", sort);
  }, [sortKey, sort]);

  // -- Sort ------------------------------------------------------------------

  const toggleSort = (col: string, def: ColumnDef<T>) => {
    if (!def.sortable) return;
    const field = def.sortKey ?? col;
    setSort((s) => {
      const next: SortState | null =
        !s || s.field !== field
          ? { field, direction: "asc" }
          : s.direction === "asc"
            ? { field, direction: "desc" }
            : null;
      props.onSortChange?.(next);
      return next;
    });
  };

  /**
   * Sort in a named direction, or clear it.
   *
   * The header cycles; the menu states. Both write the same state, so a
   * column sorted from the menu shows the header's own arrow.
   */
  const setSortTo = (
    col: string,
    def: ColumnDef<T>,
    direction: "asc" | "desc" | null,
  ) => {
    if (!def.sortable) return;
    const field = def.sortKey ?? col;
    const next: SortState | null = direction ? { field, direction } : null;
    setSort(next);
    props.onSortChange?.(next);
  };

  return {
    page,
    setPage,
    sizeForm,
    sort,
    setSort,
    data,
    meta,
    rowFilters,
    loading,
    refreshKey,
    setRefreshKey,
    isRefreshing,
    setIsRefreshing,
    toggleSort,
    setSortTo,
  };
};
