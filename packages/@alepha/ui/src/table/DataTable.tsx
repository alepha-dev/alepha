import * as React from "react";

void React;

import { ClientOnly, useAlepha } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useMemo, useRef, useState } from "react";

import { Table, TableHeader } from "../core/Table.tsx";
import { useIsMobile } from "../core/useIsMobile.ts";
import { useToast } from "../core/useToast.tsx";
import { cn } from "../core/utils.ts";
import type { DataTableBaseProps } from "./dataTableBaseProps.ts";
import { DataTableBody } from "./DataTableBody.tsx";
import { DataTableBulkBar } from "./DataTableBulkBar.tsx";
import { DATA_TABLE_CELL_PADDING } from "./dataTableCellPadding.ts";
import { DataTableFooter, PAGE_SIZES } from "./DataTableFooter.tsx";
import { DataTableHeaderRow } from "./DataTableHeaderRow.tsx";
import {
  persistedColumns,
  persistedOrder,
  persistedSize,
  persistedSort,
} from "./dataTablePersistence.ts";
import { DATA_TABLE_SQUARE_RIGHT } from "./dataTableSquareRight.ts";
import { DataTableToolbar } from "./DataTableToolbar.tsx";
import type {
  DataTableFilterFields,
  DataTableNoFilterFields,
  DataTableSource,
  BulkActionContext,
  ColumnDef,
  RowActionContext,
} from "./dataTableTypes.ts";
import { cleanFilterValues } from "./queryFilters.ts";
import { useDataTableColumns } from "./useDataTableColumns.ts";
import { useDataTableData } from "./useDataTableData.ts";
import { useDataTableFilterForm } from "./useDataTableFilterForm.ts";
import { useDataTableFilterVisibility } from "./useDataTableFilterVisibility.ts";
import { useDataTableRefresh } from "./useDataTableRefresh.ts";
import { useTableSelection } from "./useTableSelection.ts";

export type DataTableProps<
  T,
  F extends DataTableFilterFields = DataTableNoFilterFields,
> = DataTableBaseProps<T, F> & DataTableSource<T, F>;

/**
 * A data table: server-side or static rows, sorting, filters, row and bulk
 * actions, persisted preferences.
 *
 * `T` is the row. `F` is the type of `filters.fields`, written as
 * `typeof filterFields` beside the row type, which is what types `fetch`'s
 * filters, the `data` predicate, `initialValues`, `seedValues` and
 * `fromQuery`. It defaults to no filters at all, so a table given `fields`
 * without it does not compile.
 */
export const DataTable = <
  T,
  const F extends DataTableFilterFields = DataTableNoFilterFields,
>(
  props: DataTableProps<T, F>,
) => {
  /**
   * The props, with their filters read untyped. The parts below enumerate
   * filter keys at runtime and never read one by name, so the type of `F` is
   * the call site's business and one cast here keeps it out of every hook.
   */
  const untyped = props as unknown as DataTableProps<T, DataTableFilterFields>;

  /**
   * `persistenceKey`, once per facet.
   *
   * A facet that is off gets `undefined`, which is the same value every
   * persistence helper here already treats as "do not store" - so turning one
   * off takes the branch a table with no key has always taken, rather than a
   * new one. That is what keeps the default behaviour of `persistenceKey`
   * exactly as it was: with `persist` absent, all three of these ARE
   * `props.persistenceKey`.
   *
   * Primitives, so they go straight into the dependency arrays and `useState`
   * initializers below without giving any of them a new identity per render.
   */
  const filtersKey =
    props.persist?.filters === false ? undefined : props.persistenceKey;
  const columnsKey =
    props.persist?.columns === false ? undefined : props.persistenceKey;
  const sortKey =
    props.persist?.sort === false ? undefined : props.persistenceKey;
  // `pageSizes={[]}` hides the picker, and with it the reader's say in the
  // size: a size stored while the picker was still there must not outlive
  // it, or a reader who once chose 50 is stuck at 50 with no control left to
  // change it. The call site's `defaultSize` is the size, full stop.
  const sizeKey =
    props.pageSizes?.length === 0 ? undefined : props.persistenceKey;

  // State, not a constant. It was `props.defaultSize ?? 20` read once, so a
  // reader had no way to see more rows than the call site had decided for
  // them. Already in `load`'s dependency array, so changing it refetches.
  const [size, setSize] = useState<number>(() =>
    persistedSize(sizeKey, props.defaultSize),
  );
  const alepha = useAlepha();
  const { tr } = useI18n();
  const toast = useToast();
  /**
   * The whole of the phone layout, and deliberately one switch rather than a
   * scattering of `max-md:` classes: the filter controls have to be rendered
   * in exactly ONE of the two places (see `DataTableFilterDialog`), which
   * CSS cannot express. Everything else below the breakpoint follows the same
   * flag so the two halves of the layout cannot disagree.
   *
   * Safe against hydration because the whole table sits inside `ClientOnly`,
   * and `useIsMobile` reads the same `MediaQueryList` it subscribes to.
   */
  const isMobile = useIsMobile();

  const { form, definition: filterDefinition } = useDataTableFilterForm({
    props: untyped,
    filtersKey,
    alepha,
  });

  const filterVisibility = useDataTableFilterVisibility({
    definition: filterDefinition,
    filtersKey,
  });

  const {
    page,
    setPage,
    sizeForm,
    sort,
    setSort,
    data,
    meta,
    loading,
    refreshKey,
    setRefreshKey,
    isRefreshing,
    setIsRefreshing,
    toggleSort,
    setSortTo,
  } = useDataTableData({
    props: untyped,
    size,
    setSize,
    sortKey,
    form,
    alepha,
  });

  const { refresh, handleRefreshClick, resetFilters, canShare, shareFilters } =
    useDataTableRefresh({
      props: untyped,
      form,
      filterKeys: filterDefinition?.keys ?? [],
      resetShownFilters: filterVisibility.resetShown,
      filtersKey,
      alepha,
      toast,
      tr,
      setPage,
      setRefreshKey,
      setIsRefreshing,
    });

  // -- Row identity ----------------------------------------------------------

  /**
   * A row's key, in order of preference: the caller's `rowKey`, the row's own
   * `id`, then where the row sits.
   *
   * The last one used to be `Math.random()`, which is not an identity at all.
   * Every render produced a new key, so React saw every id-less row as a new
   * row and remounted it: focus in an inline input was lost the moment
   * anything else re-rendered, and the list re-animated on every keystroke.
   * Selection was broken by the same thing - `selection.has(rowKey(item))`
   * compared against a key generated one render earlier, so it never matched.
   */
  const rowKeys = useMemo(
    () =>
      data.map((item, index) => {
        if (props.rowKey) return props.rowKey(item);
        const id = (item as { id?: unknown })?.id;
        // Coercion at a boundary: the value is a form/route/chart primitive
        // whose declared type is wider than what can reach here.
        // oxlint-disable-next-line typescript/no-base-to-string -- a coercion at a boundary, see the comment above
        return id != null ? String(id) : `page-${page}-row-${index}`;
      }),
    [data, page, props.rowKey],
  );

  /**
   * Selection asks for a key by item, not by index. Every item it can ask
   * about is one of `data`'s, so a lookup keyed on identity covers it without
   * an O(n) scan per call.
   */
  const rowKeyByItem = useMemo(() => {
    const map = new Map<T, string>();
    data.forEach((item, index) => map.set(item, rowKeys[index]));
    return map;
  }, [data, rowKeys]);

  const rowKey = useCallback(
    (item: T): string => rowKeyByItem.get(item) ?? "",
    [rowKeyByItem],
  );

  // -- Selection -------------------------------------------------------------

  const {
    selection,
    selectedItems,
    allSelected,
    someSelected,
    toggleRow,
    toggleAll,
    clearSelection,
  } = useTableSelection(data, rowKey);

  // The bulk actions offered for THIS selection: an action's `visible`
  // predicate reads the selected rows. Computed once, here, so the pill's
  // contents and the pill's own presence come from the same list.
  const visibleBulkActions = useMemo(
    () =>
      (props.bulkActions ?? []).filter(
        (action) => action.visible?.(selectedItems) ?? true,
      ),
    [props.bulkActions, selectedItems],
  );

  const {
    allColumnKeys,
    visibleColumns,
    setVisibleColumns,
    orderedKeys,
    setColumnOrder,
    moveColumn,
    reorderColumn,
    toggleColumn,
    orderAnnouncement,
  } = useDataTableColumns({ props: untyped, columnsKey, tr });

  /**
   * ⚠️ A changed `persistenceKey` is a changed SCOPE, and this is where that
   * is handled.
   *
   * Every caller encodes its scope in that key - `lor.activity.${project.id}`,
   * `lor.epics.${project.id}` - so switching project changes it. Nothing acted
   * on that before, and `load` re-runs only on `[page, size, sortParam,
   * refreshKey, form, alepha]`, none of which a project switch touches. The
   * router does not remount on a param-only navigation either, so the table
   * kept serving the PREVIOUS project's rows under the new project's name
   * (feedback #2096).
   *
   * `refreshKey` is bumped rather than relying on the re-read: two projects
   * can share a stored sort and size, and then no dependency of `load` would
   * change and nothing would refetch. That equality is the bug's whole
   * mechanism, so the refetch cannot be a side effect of the values moving.
   *
   * ⚠️ Adjusted during RENDER, not in an effect, and that is load-bearing.
   * The sort effect (`useDataTableData`) and the column writes
   * (`useDataTableColumns`) are keyed on `persistenceKey` too, so on the
   * render where it changes they would fire in the same flush and write the
   * OUTGOING scope's state under the INCOMING key - silently
   * overwriting the project you just opened with the one you just left. React
   * re-renders before committing this, so by the time those effects run the
   * state is already the new scope's and they write back what was just read.
   *
   * ⚠️ `props.fetch` is still NOT a dependency of `load`. That is the loop
   * `fetchRef` exists to prevent, and several callers write a store atom from
   * inside their fetcher.
   *
   * Filter VALUES are deliberately not reset here: `useForm` captures its
   * `initialValues` once, so resetting them is form surgery rather than a
   * state assignment. They are also not clobbered - the filter-persist effect
   * writes only on `form:change` / `form:submit:success`, never on mount - so
   * the stored filters of the project you left stay its own.
   */
  const scopeRef = useRef(props.persistenceKey);
  if (scopeRef.current !== props.persistenceKey) {
    scopeRef.current = props.persistenceKey;
    setPage(0);
    setSize(persistedSize(sizeKey, props.defaultSize));
    setSort(persistedSort(sortKey, props.defaultSort));
    setVisibleColumns(persistedColumns(columnsKey, props.columns));
    // Same render pass as the rest, and for the identical reason: the effects
    // keyed on `persistenceKey` fire in one flush, so an order left behind
    // here would be written back under the INCOMING key.
    setColumnOrder(persistedOrder(columnsKey, props.columns));
    // Which filters are on the bar is the scope's too, and read here for the
    // same reason: the project just opened must not show the bar of the one
    // just left.
    filterVisibility.rereadShown(filtersKey);
    setRefreshKey((k) => k + 1);
  }

  // -- Render ---------------------------------------------------------------

  // The reader's order, not the declaration's.
  const cols = orderedKeys.map((key) => [key, props.columns[key]!]) as Array<
    [string, ColumnDef<T>]
  >;
  const visibleCols = cols.filter(([key]) => visibleColumns.has(key));
  const hasCheckbox = Boolean(props.bulkActions?.length);
  const hasRowActions = Boolean(props.rowActions);

  const rowCtx: RowActionContext = useMemo(
    () => ({ refresh, clearSelection }),
    [refresh, clearSelection],
  );
  const bulkCtx: BulkActionContext = useMemo(
    () => ({ refresh, clearSelection }),
    [refresh, clearSelection],
  );

  /**
   * How many filters currently narrow the list — a count rather than the
   * boolean this used to be, because on a phone the bar is behind a button
   * and the trigger's badge is the only thing that says the table is
   * filtered at all.
   */
  const activeFilterCount = useMemo(() => {
    if (!props.filters || !form) return 0;
    return Object.keys(cleanFilterValues(form.currentValues ?? {})).length;
  }, [props.filters, form, refreshKey]);
  const hasActiveFilters = activeFilterCount > 0;
  /**
   * Whether Reset filters would change anything: a value set, or a bar that
   * is not the one the table declares. Not the count alone, or a reader who
   * removed a default filter would have no way to bring it back.
   */
  const canResetFilters =
    hasActiveFilters || filterVisibility.differsFromDeclaration;

  // The empty state is showing, as opposed to the skeleton that also renders
  // on `data.length === 0`. Read by the `<Table>` height as well as the body,
  // so the two cannot disagree.
  const isEmptyState = !loading && data.length === 0;

  const showToolbar =
    Boolean(props.filters) ||
    Boolean(props.toolbar) ||
    Boolean(props.actions?.length) ||
    !props.hideColumnPicker ||
    !props.hideActionsMenu;
  const cellPadding = DATA_TABLE_CELL_PADDING[props.cellPadding ?? "normal"];
  const squareRight = props.squareRight
    ? DATA_TABLE_SQUARE_RIGHT[`${props.squareRight}`]
    : undefined;
  // The footer holds two controls, the size picker and the page links, and
  // the count beside them. A table that hid the picker (`pageSizes={[]}`)
  // and fits on one page has neither, and "Page 1 of 1" alone is a bar
  // saying nothing, so it goes. The links' condition is the footer's own.
  const showFooter =
    (props.pageSizes ?? PAGE_SIZES).length > 0 ||
    Boolean(meta?.totalPages && meta.totalPages > 1);
  const showColumnPicker = !props.hideColumnPicker && allColumnKeys.length > 0;
  const showActionsMenu = !props.hideActionsMenu;

  return (
    <ClientOnly>
      <div className={cn("flex flex-col gap-2", props.className)}>
        {props.header && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{props.header}</div>
          </div>
        )}

        {showToolbar && (
          <DataTableToolbar<T>
            columns={props.columns}
            filters={untyped.filters}
            form={form}
            filterDefinition={filterDefinition}
            shownFilters={filterVisibility.shown}
            onShownFiltersChange={filterVisibility.setShown}
            canResetFilters={canResetFilters}
            toolbar={props.toolbar}
            actions={props.actions}
            isMobile={isMobile}
            showColumnPicker={showColumnPicker}
            showActionsMenu={showActionsMenu}
            activeFilterCount={activeFilterCount}
            canShare={canShare}
            resetFilters={resetFilters}
            shareFilters={shareFilters}
            orderedKeys={orderedKeys}
            visibleColumns={visibleColumns}
            toggleColumn={toggleColumn}
            reorderColumn={reorderColumn}
            isRefreshing={isRefreshing}
            handleRefreshClick={handleRefreshClick}
            className={cn(squareRight?.top, props.chromeClassName)}
          />
        )}

        {hasCheckbox && selection.size > 0 && visibleBulkActions.length > 0 && (
          <DataTableBulkBar<T>
            selection={selection}
            selectedItems={selectedItems}
            visibleBulkActions={visibleBulkActions}
            bulkCtx={bulkCtx}
            clearSelection={clearSelection}
          />
        )}

        {/*
          The toolbar, the rows and the footer are one panel: each facing edge
          is flattened and its border dropped so no double line appears, and
          `-mt-2` cancels the wrapper's `gap-2`. The footer half follows
          `showFooter`, which is true for every table that keeps its size
          picker: gating the footer on `meta` alone would pop the bar in and
          flip this bottom border on every load, since `meta` starts null and
          only fills after the fetch. Only a table that hid the picker can
          lose it, and then the rows close the panel themselves.
        */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-auto rounded-md border",
            showToolbar && "-mt-2 rounded-t-none border-t-0",
            showFooter ? "rounded-b-none border-b-0" : squareRight?.bottom,
            // With no toolbar the rows open the table, so their top-right
            // corner is the one `squareRight` squares.
            !showToolbar && squareRight?.top,
            // `<Table>` wraps the table in a container div whose classes it
            // hardcodes, and only this table needs that container to grow,
            // so the one class it needs is set from out here instead.
            //
            // `grow`, NOT `flex-1`: `flex-1` sets the basis to 0, and in the
            // ordinary case this wrapper has no height of its own, so a 0
            // basis with nothing to grow into collapses the table to nothing.
            // `grow` keeps the content basis and only spends space that is
            // actually free, which is the full-height case.
            "[&>[data-slot=table-container]]:grow",
          )}
        >
          {/* `h-full` ONLY while the empty state is what is in the body.
              It is what lets that one row take the height the scroller grew
              into, so `align-middle` can centre the state in it.

              ⚠️ Never unconditionally. A CSS table given a height larger
              than its content does not leave the surplus at the bottom, it
              DISTRIBUTES IT ACROSS THE ROWS - so an unconditional `h-full`
              silently turns a short table into a tall one: Lore's Apps page,
              two rows in a full-height pane, rendered them 239px each. No
              unit test sees it (jsdom computes no layout) and it is invisible
              on a table long enough to fill its own container, which is why
              it reached e2e rather than review. */}
          <Table className={cn(isEmptyState && "h-full")}>
            {/* `bg-muted`, fully opaque, NOT the base header's `bg-muted/50`:
                this header is sticky, so anything translucent lets the rows
                scroll visibly through the column labels. Same tint, no
                transparency.

                Two inset lines, not one. The bottom is the divider against the
                first row; the top is the `--bevel` highlight, which is what
                gives the band its thickness. Inset shadows rather than borders
                because a border on a sticky `<thead>` is dropped by the
                collapsed table border model, and because the two lines have to
                sit INSIDE the header's own height: it is pinned at `top-0`
                against a scrolling body, so anything painted outside it is
                painted over. */}
            <TableHeader
              className={cn(
                "bg-muted sticky top-0 z-10 shadow-[inset_0_1px_0_0_var(--bevel),inset_0_-1px_0_0_var(--border)]",
                props.chromeClassName,
              )}
            >
              <DataTableHeaderRow<T>
                headClassName={cellPadding.head}
                visibleCols={visibleCols}
                hasCheckbox={hasCheckbox}
                hasRowActions={hasRowActions}
                allSelected={allSelected}
                someSelected={someSelected}
                toggleAll={toggleAll}
                sort={sort}
                toggleSort={toggleSort}
                setSortTo={setSortTo}
                moveColumn={moveColumn}
                toggleColumn={toggleColumn}
              />
            </TableHeader>
            <DataTableBody<T>
              cellClassName={cellPadding.cell}
              data={data}
              rowKeys={rowKeys}
              loading={loading}
              visibleCols={visibleCols}
              hasCheckbox={hasCheckbox}
              hasRowActions={hasRowActions}
              hasActiveFilters={hasActiveFilters}
              selection={selection}
              toggleRow={toggleRow}
              rowCtx={rowCtx}
              rowActions={props.rowActions}
              onRowClick={props.onRowClick}
              onRowHover={props.onRowHover}
              empty={props.empty}
              emptyMessage={props.emptyMessage}
              emptyState={props.emptyState}
              noMatchState={props.noMatchState}
            />
          </Table>
        </div>

        {/* A move is otherwise silent: nothing about a reordered table is
            spoken, and the visual change is the only feedback. Outside the
            table so it is not read as a cell. */}
        <span aria-live="polite" className="sr-only">
          {orderAnnouncement}
        </span>

        {showFooter && (
          <DataTableFooter
            pageSizes={props.pageSizes}
            sizeForm={sizeForm}
            meta={meta}
            isMobile={isMobile}
            setPage={setPage}
            className={cn(squareRight?.bottom, props.chromeClassName)}
          />
        )}
      </div>
    </ClientOnly>
  );
};
