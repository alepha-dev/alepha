import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@alepha/ui/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import { type Page, type ZObject, z } from "alepha";
import { ClientOnly, useAlepha } from "alepha/react";
import { type FormModel, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  FunnelX,
  Inbox,
  MoreVertical,
  RefreshCw,
  X,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { paginateLocal } from "./paginate-local.ts";
import { useTableSelection } from "./use-table-selection.ts";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface ColumnDef<T> {
  label: string;
  cell: (item: T) => ReactNode;
  sortable?: boolean;
  /**
   * Sort key sent to the API. Defaults to the column key.
   */
  sortKey?: string;
  /**
   * Static-data mode only: the value this column sorts on, for a column
   * whose sort key is not a plain property of the row (a derived total, a
   * joined label). Defaults to `item[sortKey]`.
   *
   * Ignored when the table fetches: there the server owns the ordering.
   */
  sortValue?: (item: T) => unknown;
  /**
   * When true, the column starts hidden. The user can still toggle it
   * on via the built-in column picker. Pass `hideColumnPicker` on the
   * table to forbid toggling entirely.
   */
  defaultHidden?: boolean;
  className?: string;
  align?: "left" | "right" | "center";
}

/**
 * Context passed to every row-action `onClick`. `refresh()` re-fires the
 * current fetch with the current filters/sort — call it after a mutation
 * so the table reflects the new state without a manual reload.
 *
 * ⚠️ In static-data mode there is no fetch to re-fire, so `refresh()` only
 * returns to page 0: the rows belong to the caller, and a mutation has to
 * be written back into the array passed as `data`. The table renders the
 * new array on the same render, without it.
 */
export interface RowActionContext {
  refresh: () => void;
}

export interface RowAction<T> {
  label: string;
  icon?: IconType;
  onClick: (item: T, ctx: RowActionContext) => void | Promise<void>;
  destructive?: boolean;
  disabled?: (item: T) => boolean;
}

/**
 * Context passed to every bulk-action `onClick`. `clearSelection()`
 * empties the checkbox set; `refresh()` re-fires the current fetch.
 */
export interface BulkActionContext {
  refresh: () => void;
  clearSelection: () => void;
}

export interface BulkAction<T> {
  label: string;
  icon?: IconType;
  onClick: (selected: T[], ctx: BulkActionContext) => void | Promise<void>;
  destructive?: boolean;
}

/**
 * A standalone toolbar icon-button, rendered in the right-hand icon group
 * next to the column picker and separated from the filter area by a divider.
 * Use for table-scoped actions (e.g. "Upload", "New") that aren't tied to a
 * row or a selection. The table renders the ghost icon button + tooltip so it
 * matches the built-in column-picker / refresh controls.
 */
export interface TableAction {
  icon: IconType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * High-level filter slot. AlephaTable creates the `useForm` internally,
 * wraps `render`'s output in a `<form>` element, persists values under
 * `persistenceKey` when set, and refetches on submit (and on every
 * change, debounced, by default).
 *
 * The render function receives the typed form so callers wire inputs
 * with `form.input.<field>` exactly like a hand-rolled `useForm`.
 */
export interface AlephaTableFilters {
  schema: ZObject;
  initialValues?: Record<string, any>;
  /**
   * Filter values that outrank the persisted ones on mount.
   *
   * `initialValues` is what the table starts from when the reader has never
   * chosen anything; a persisted choice wins over it, which is the right
   * default for a preference. This is the opposite case: values the caller
   * derived from *how the reader got here* — typically a URL param on a
   * drill-through link — where landing on last week's stored filter instead
   * would ignore the link that was just clicked.
   *
   * Read once, at mount, exactly like `initialValues`. Change the
   * component's `key` to re-seed on a later arrival.
   *
   * **Transient, and by construction.** Persistence is written from
   * `form:change` / `form:submit:success` only, never on mount — so a seed
   * shows in the toolbar and narrows the fetch without overwriting the
   * filter the reader chose for themselves last time. Touch any control and
   * the resulting values (seed included) become the stored choice, which is
   * the right moment for it: that is the reader choosing.
   */
  seedValues?: Record<string, any>;
  render: (form: FormModel<ZObject>) => ReactNode;
}

interface SortState {
  field: string;
  direction: "asc" | "desc";
}

export type TableFetcher<T> = (params: {
  page: number;
  size: number;
  sort?: string;
  filters?: Record<string, any>;
}) => Promise<Page<T>>;

/**
 * Where the rows come from. Exactly one of the two.
 *
 * `data` is not sugar over `fetch`: a fetcher closing over an in-memory
 * array cannot work, because the table holds `fetch` in a ref that is
 * deliberately excluded from its load effect (see `fetchRef`), so the
 * closure goes stale the moment the caller's array changes. Static rows
 * therefore bypass the fetch path entirely and are derived synchronously.
 */
export type AlephaTableSource<T> =
  | {
      /**
       * Fetcher invoked with paging + sort + filters. Should return an
       * Alepha `Page<T>`.
       */
      fetch: TableFetcher<T>;
      data?: never;
      filter?: never;
    }
  | {
      /**
       * Rows the caller already holds. The table filters, sorts and pages
       * them in memory and never issues a request.
       *
       * Use it when the array is the page's data rather than the table's —
       * shared with a chart, a count, an aside — so that one array stays
       * the single source of truth. For anything the reader can outgrow,
       * pass `fetch` and let the server page it.
       */
      data: T[];
      /**
       * Static-data mode only: predicate replacing the built-in field
       * matching, which pairs each filter value with the same-named
       * property (strings as a case-insensitive substring, arrays by
       * membership, everything else strictly).
       *
       * Reach for it as soon as a filter is not a field: a `search` box
       * spanning several columns, a range, a joined label. Only ever
       * called with filter values that are actually set.
       */
      filter?: (item: T, filters: Record<string, any>) => boolean;
      fetch?: never;
    };

export type AlephaTableProps<T> = AlephaTableBaseProps<T> &
  AlephaTableSource<T>;

export interface AlephaTableBaseProps<T> {
  /**
   * Column definitions, keyed by the property name they read from.
   */
  columns: Record<string, ColumnDef<T>>;
  /**
   * Per-row action menu builder. Return an array of `RowAction` per
   * item. Each `onClick` receives `(item, { refresh })`.
   */
  rowActions?: (item: T) => RowAction<T>[];
  /**
   * Actions applied to selected rows (enables checkbox column). Each
   * `onClick` receives `(items, { refresh, clearSelection })`.
   */
  bulkActions?: BulkAction<T>[];
  /**
   * Page size the table opens on. The reader can change it from the footer;
   * with `persistenceKey` set, their choice is remembered and wins over this.
   */
  defaultSize?: number;
  /**
   * Sizes offered in the footer picker. Defaults to {@link PAGE_SIZES}.
   *
   * Pass `[]` to hide the picker entirely, for a table whose page size is
   * not the reader's business.
   */
  pageSizes?: number[];
  /**
   * Stable row identifier. Defaults to `item.id`.
   */
  rowKey?: (item: T) => string;
  /**
   * Click handler invoked when a row is clicked (excluding action
   * buttons).
   */
  onRowClick?: (item: T) => void;
  /**
   * Auto-refresh interval in ms (only when document is visible).
   *
   * Meaningless in static-data mode — there is no request to repeat, and a
   * changed `data` array is already on screen the render it changes.
   */
  pollMs?: number;
  /**
   * External refetch trigger. Bump this value (e.g. from a `useState`
   * counter) after a mutation performed *outside* the table — such as a
   * toolbar upload action — to make the table reload. Row/bulk actions
   * already get `ctx.refresh()`; this is the escape hatch for everything
   * else. Changing it resets to page 0 and refetches; the initial value
   * is ignored (the table fetches on mount regardless).
   *
   * Not needed in static-data mode: a new `data` array is picked up on its
   * own. Bumping this there only resets to page 0.
   */
  refreshSignal?: number | string;
  /**
   * High-level filter form. AlephaTable owns the `useForm`, renders the
   * inputs inside a `<form>` in the toolbar, and refetches on
   * submit/change.
   *
   * Mutually exclusive with `form` (legacy: caller-owned form). When
   * both are passed, `filters` wins.
   */
  filters?: AlephaTableFilters;
  /**
   * When set, filter values, column visibility, and sort state are
   * persisted to `localStorage` under this key. Pick a key that's
   * unique per page and per scope (e.g. `"admin.users"`,
   * `\`lor.board.${campaignId}\``).
   */
  persistenceKey?: string;
  /**
   * Hide the built-in column visibility dropdown in the toolbar.
   */
  hideColumnPicker?: boolean;
  /**
   * Hide the built-in actions menu (Refresh, Reset filters).
   */
  hideActionsMenu?: boolean;
  /**
   * Extra slot rendered to the right of the filter inputs in the
   * toolbar — typically a "New" / "Create" button.
   *
   * Vertically centred in the bar (`self-center`) regardless of its own
   * height, so it no longer has to match the filter inputs. It used to inherit
   * the bar's `items-end`, which meant anything shorter than h-9 hung off the
   * bottom edge and a labelled filter dragged the button down with it.
   */
  toolbar?: ReactNode;
  /**
   * Standalone icon-button actions rendered in the toolbar's right-hand
   * icon group, before the column picker and separated from the filter
   * area by a divider. The table renders the ghost icon button + tooltip
   * itself, so callers only supply the icon/label/handler.
   */
  actions?: TableAction[];
  /**
   * Extra classes applied to the outer wrapper.
   */
  className?: string;
  /**
   * Message shown when the page is empty. Defaults to "No results".
   */
  emptyMessage?: string;
  /**
   * Rich empty-state node rendered when the page is empty — e.g. an icon +
   * message + optional call-to-action. Overrides `emptyMessage` when set.
   */
  empty?: ReactNode;
  /**
   * Free-form content rendered above the toolbar (e.g. a page title).
   */
  header?: ReactNode;
  /**
   * Initial sort state. When `persistenceKey` is set, a persisted sort
   * takes precedence over this.
   */
  defaultSort?: SortState | null;
  /**
   * Called whenever the user toggles a column header. Receives the new
   * sort state (`null` when sort is cleared). Use this if you need a
   * persistence layer beyond `persistenceKey` (e.g. URL state).
   */
  onSortChange?: (sort: SortState | null) => void;
  /**
   * Legacy: caller-owned filter form. Prefer `filters` (which has
   * AlephaTable own the form). When `filters` is set, this prop is
   * ignored.
   */
  form?: FormModel<ZObject>;
  /**
   * When true (default when `filters` is set), the table refetches on
   * every `form:change` event, debounced by 250ms. Set to `false` to
   * require an explicit submit.
   */
  autoApplyFilters?: boolean;
}

const defaultRowKey = (item: unknown): string =>
  // Coercion at a boundary: the value is a form/route/chart primitive whose
  // declared type is wider than what can reach here.
  // oxlint-disable-next-line typescript/no-base-to-string
  String((item as { id?: unknown })?.id ?? Math.random());

const EMPTY_FILTERS_SCHEMA = z.object({}) as ZObject;

/** Synchronous localStorage read. Returns undefined on miss or error. */
const readPersisted = <V,>(key: string, suffix: string): V | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${key}.${suffix}`);
    return raw == null ? undefined : (JSON.parse(raw) as V);
  } catch {
    return undefined;
  }
};

/** Synchronous localStorage write. Empty objects/null delete the key. */
const writePersisted = (key: string, suffix: string, value: unknown): void => {
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
 * Page sizes the footer offers.
 *
 * No "all". Pagination here is server-side, so an unbounded fetch is a query
 * whose cost grows with the biggest table in the product and is paid by the
 * reader who can least afford it. 100 covers "let me scan the lot" without
 * that.
 */
export const PAGE_SIZES = [10, 20, 50, 100];

export function AlephaTable<T>(props: AlephaTableProps<T>) {
  const rowKey = props.rowKey ?? defaultRowKey;

  // State, not a constant. It was `props.defaultSize ?? 20` read once, so a
  // reader had no way to see more rows than the call site had decided for
  // them. Already in `load`'s dependency array, so changing it refetches.
  const [size, setSize] = useState<number>(
    () =>
      (props.persistenceKey
        ? readPersisted<number>(props.persistenceKey, "size")
        : undefined) ??
      props.defaultSize ??
      20,
  );
  const pageSizes = props.pageSizes ?? PAGE_SIZES;
  const alepha = useAlepha();
  const { tr } = useI18n();

  // -- Filter form (internal when `filters` is set, else legacy `form`) -----

  // Read persisted filter values synchronously so they reach useForm's
  // first invocation. Reading inside an effect would be too late —
  // useForm captures `initialValues` only once via useMemo.
  const persistedFilterValues = useMemo(() => {
    if (!props.persistenceKey || !props.filters) return undefined;
    return readPersisted<Record<string, any>>(props.persistenceKey, "filters");
  }, [props.persistenceKey, props.filters]);

  const mergedFilterInitialValues = useMemo<Record<string, any>>(
    () => ({
      ...props.filters?.initialValues,
      ...persistedFilterValues,
      // Last, so it beats the stored choice — see `seedValues`. A drill-through
      // link that lost to a filter the reader set last week would be a link
      // that does nothing.
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
  const [sort, setSort] = useState<SortState | null>(() => {
    if (props.persistenceKey) {
      const persisted = readPersisted<SortState>(props.persistenceKey, "sort");
      if (persisted) return persisted;
    }
    return props.defaultSort ?? null;
  });
  const [fetchedData, setData] = useState<T[]>([]);
  const [fetchedMeta, setMeta] = useState<Page<T>["page"] | null>(null);
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

  const load = useCallback(async () => {
    // Static mode owns no request. Bail before touching `loading` too, so a
    // table fed an array never flashes the skeleton over rows it already has.
    const fetcher = fetchRef.current;
    if (!fetcher) return;
    setLoading(true);
    try {
      const res = await fetcher({
        page,
        size,
        sort: sortParam,
        filters: form?.currentValues,
      });
      setData(res.content);
      setMeta(res.page);
    } catch (error) {
      // Surface read failures through the same `react:action:error` channel
      // that useAction/useQuery use, so a mounted <ActionErrorToaster /> toasts
      // them. Keep the previous rows on screen rather than blanking the table.
      void alepha.events.emit("react:action:error", {
        type: "custom",
        id: "alepha-table:load",
        error: error as Error,
      });
    } finally {
      setLoading(false);
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
    if (!props.persistenceKey) return;
    writePersisted(props.persistenceKey, "sort", sort);
  }, [props.persistenceKey, sort]);

  // -- Refresh + reset wiring -----------------------------------------------

  const refresh = useCallback(() => {
    setPage(0);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRefreshClick = useCallback(() => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [refresh]);

  // React to the external `refreshSignal` prop. The first render seeds the
  // ref without refetching (the mount effect already loads); every later
  // change triggers a refresh. Kept separate from `load`'s deps so an inline
  // `fetch` closure can't self-trigger a loop (see `fetchRef` above).
  const refreshSignalRef = useRef(props.refreshSignal);
  useEffect(() => {
    if (refreshSignalRef.current === props.refreshSignal) return;
    refreshSignalRef.current = props.refreshSignal;
    refresh();
  }, [props.refreshSignal, refresh]);

  const resetFilters = useCallback(() => {
    if (!form || !props.filters) return;
    // Per-field `.set(undefined)` is necessary: `setInitialValues({})`
    // doesn't emit `form:change` for deleted keys, so inputs stay
    // visually populated and subscribers don't refetch. Explicit set
    // keeps everyone in sync.
    const keys = Object.keys(z.schema.shape(props.filters.schema));
    for (const key of keys) {
      const input = (form.input as Record<string, { set?: (v: any) => void }>)[
        key
      ];
      input?.set?.(undefined);
    }
  }, [form, props.filters]);

  // -- Form event subscriptions ---------------------------------------------

  // Refetch on explicit submit (manual Apply, programmatic submit, etc.).
  useEffect(() => {
    if (!form) return;
    return alepha.events.on("form:submit:success", (event) => {
      if (event.id !== form.id) return;
      setPage(0);
      setRefreshKey((k) => k + 1);
    });
  }, [alepha, form]);

  // Refetch on change (debounced) when autoApplyFilters is on. Default
  // is on whenever AlephaTable owns the form (`filters` prop).
  const autoApply = props.autoApplyFilters ?? Boolean(props.filters);
  useEffect(() => {
    if (!form || !autoApply) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsub = alepha.events.on("form:change", (event) => {
      if (event.id !== form.id) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        setPage(0);
        setRefreshKey((k) => k + 1);
      }, 250);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsub();
    };
  }, [alepha, form, autoApply]);

  // Persist filter values to localStorage on change.
  useEffect(() => {
    if (!props.persistenceKey || !form || !props.filters) return;
    const persist = () => {
      const clean: Record<string, any> = {};
      const values = form.currentValues ?? {};
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined || v === null || v === "") continue;
        if (Array.isArray(v) && v.length === 0) continue;
        clean[k] = v;
      }
      writePersisted(props.persistenceKey!, "filters", clean);
    };
    const unsubs = [
      alepha.events.on("form:change", (event) => {
        if (event.id !== form.id) return;
        persist();
      }),
      alepha.events.on("form:submit:success", (event) => {
        if (event.id !== form.id) return;
        persist();
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [alepha, form, props.filters, props.persistenceKey]);

  // -- Polling ---------------------------------------------------------------

  useEffect(() => {
    if (!props.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setRefreshKey((k) => k + 1);
    }, props.pollMs);
    return () => clearInterval(id);
  }, [props.pollMs]);

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

  // -- Column visibility -----------------------------------------------------

  const allColumnKeys = useMemo(
    () => Object.keys(props.columns),
    [props.columns],
  );

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (props.persistenceKey) {
      const persisted = readPersisted<string[]>(
        props.persistenceKey,
        "columns",
      );
      if (persisted) {
        return new Set(persisted.filter((k) => k in props.columns));
      }
    }
    return new Set(
      allColumnKeys.filter((k) => !props.columns[k].defaultHidden),
    );
  });

  useEffect(() => {
    if (!props.persistenceKey) return;
    writePersisted(props.persistenceKey, "columns", [...visibleColumns]);
  }, [props.persistenceKey, visibleColumns]);

  const toggleColumn = (id: string) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // -- Render ---------------------------------------------------------------

  const cols = Object.entries(props.columns) as Array<[string, ColumnDef<T>]>;
  const visibleCols = cols.filter(([key]) => visibleColumns.has(key));
  const hasCheckbox = Boolean(props.bulkActions?.length);
  const hasRowActions = Boolean(props.rowActions);

  const rowCtx: RowActionContext = useMemo(() => ({ refresh }), [refresh]);
  const bulkCtx: BulkActionContext = useMemo(
    () => ({ refresh, clearSelection }),
    [refresh, clearSelection],
  );

  const hasActiveFilters = useMemo(() => {
    if (!props.filters || !form) return false;
    const values = form.currentValues ?? {};
    for (const v of Object.values(values)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
    }
    return false;
  }, [props.filters, form, refreshKey]);

  const showToolbar =
    Boolean(props.filters) ||
    Boolean(props.toolbar) ||
    Boolean(props.actions?.length) ||
    !props.hideColumnPicker ||
    !props.hideActionsMenu;
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
          // `bg-muted`, paired with the pagination footer below: the filter bar
          // and the footer are the table's chrome and bracket it top and
          // bottom, so they sit one step off the page while the table itself
          // (header included) stays on it. They were `bg-card` — pure white in
          // light, the same colour as the page, so neither had an edge.
          //
          // The controls need an explicit fill because of that. shadcn ships
          // inputs and select triggers `bg-transparent` in light and only fills
          // them in dark (`dark:bg-input/30`) — the light case assumes a white
          // page, where transparent already reads as a white field. On this bar
          // it does not: they would take the muted grey and the border alone
          // would have to say "input". Scoped here rather than to the
          // primitives, which `yarn w @alepha/ui sync` overwrites.
          //
          // `bg-background` suits both modes: white against the muted bar in
          // light, near-black in dark, so the control reads as a well sunk
          // into the chrome either way. The `dark:` copy is not redundant —
          // the primitives ship `dark:bg-input/30` at (0,2,0), a translucent
          // WHITE wash that leaves the field lighter than the bar. Only the
          // dark-scoped rule (0,3,0) outranks it, and without it the two
          // controls disagreed: the trigger went dark, the input stayed light.
          <div className="bg-muted [&_:is(input,[role=combobox])]:bg-background dark:[&_:is(input,[role=combobox])]:bg-background flex flex-wrap items-end gap-2 rounded-md rounded-b-none border p-2">
            {props.filters && form ? (
              <form
                {...form.props}
                className="flex flex-1 flex-wrap items-end gap-2"
              >
                {props.filters.render(form)}
              </form>
            ) : (
              <div className="flex flex-1" />
            )}
            {/*
              `self-center`, against the bar's own `items-end`.

              The bar bottom-aligns because a filter Control may carry a label,
              and a row of labelled controls has to line up on the inputs rather
              than on the top of the tallest label. Everything to the right of
              the filters is a bare control with no label of its own, so
              inheriting that baseline pinned it to the bottom of whatever the
              filter area happened to measure — a "New" button sitting low
              against a labelled select, moving as soon as a filter gained or
              lost its label.

              Centring only the trailing content keeps the filter row's own
              alignment intact and makes the actions independent of it.
            */}
            {props.toolbar && (
              <div className="self-center">{props.toolbar}</div>
            )}
            <TooltipProvider>
              <div className="flex items-center gap-1 self-center">
                {props.actions?.length ? (
                  <>
                    {props.actions.map((action) => {
                      const ActionIcon = action.icon;
                      return (
                        <Tooltip key={action.label}>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-9 w-9 p-0"
                                aria-label={action.label}
                                disabled={action.disabled}
                                onClick={action.onClick}
                              />
                            }
                          >
                            <ActionIcon className="size-4" />
                          </TooltipTrigger>
                          <TooltipContent>{action.label}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                    {(showColumnPicker || showActionsMenu) && (
                      <span
                        aria-hidden
                        className="bg-border mx-1 h-5 w-px self-center"
                      />
                    )}
                  </>
                ) : null}
                {showColumnPicker && (
                  <ColumnPicker<T>
                    columns={props.columns}
                    visible={visibleColumns}
                    onToggle={toggleColumn}
                  />
                )}
                {showActionsMenu && props.filters && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={tr("alephaTable.resetFilters", {
                            default: "Reset filters",
                          })}
                          disabled={!hasActiveFilters}
                          onClick={resetFilters}
                        />
                      }
                    >
                      <FunnelX className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {tr("alephaTable.resetFilters", {
                        default: "Reset filters",
                      })}
                    </TooltipContent>
                  </Tooltip>
                )}
                {showActionsMenu && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={tr("alephaTable.refresh", {
                            default: "Refresh",
                          })}
                          disabled={isRefreshing}
                          onClick={handleRefreshClick}
                        />
                      }
                    >
                      <RefreshCw
                        className={cn("size-4", isRefreshing && "animate-spin")}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {tr("alephaTable.refresh", { default: "Refresh" })}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TooltipProvider>
          </div>
        )}

        {hasCheckbox &&
          selection.size > 0 && (
            // Linear-style floating action pill: fixed at the bottom-center of
            // the viewport, dark surface that stays readable in both themes
            // because the colors are hard-coded (theme-relative `bg-foreground`
            // inverts awkwardly against a white container in dark mode).
            <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
              <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-zinc-100 shadow-lg ring-1 ring-white/10 duration-150">
                <span className="pl-2 text-sm">
                  {tr("alephaTable.selected", {
                    default: `${selection.size} selected`,
                    args: [String(selection.size)],
                  })}
                </span>
                <span className="mx-1 h-4 w-px bg-white/20" />
                {props.bulkActions?.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <Button
                      key={action.label}
                      size="sm"
                      className={
                        action.destructive
                          ? "h-8 bg-red-600 text-white hover:bg-red-500"
                          : "h-8 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100"
                      }
                      onClick={() => action.onClick(selectedItems, bulkCtx)}
                    >
                      {ActionIcon && <ActionIcon className="size-4" />}
                      {action.label}
                    </Button>
                  );
                })}
                <span className="mx-1 h-4 w-px bg-white/20" />
                <Button
                  size="icon"
                  className="size-8 bg-transparent text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                  onClick={clearSelection}
                  aria-label={tr("alephaTable.clearSelection", {
                    default: "Clear selection",
                  })}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          )}

        {/*
          The toolbar, the rows and the footer are one panel: each facing edge
          is flattened and its border dropped so no double line appears, and
          `-mt-2` cancels the wrapper's `gap-2`. The footer half is
          unconditional because the page row below already renders
          unconditionally — gating it on `meta` would pop the bar in and flip
          this bottom border on every load, since `meta` starts null and only
          fills after the fetch.
        */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-auto rounded-md border",
            showToolbar && "-mt-2 rounded-t-none border-t-0",
            "rounded-b-none border-b-0",
          )}
        >
          <Table>
            {/* `bg-muted`, fully opaque, NOT the base header's `bg-muted/50`:
                this header is sticky, so anything translucent lets the rows
                scroll visibly through the column labels. Same tint, no
                transparency. */}
            <TableHeader className="bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
              <TableRow>
                {hasCheckbox && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onCheckedChange={() => toggleAll()}
                      aria-label={tr("alephaTable.selectAll", {
                        default: "Select all rows",
                      })}
                    />
                  </TableHead>
                )}
                {visibleCols.map(([key, def]) => {
                  const sorted =
                    def.sortable && sort?.field === (def.sortKey ?? key);
                  return (
                    <TableHead
                      key={key}
                      className={cn(
                        def.className,
                        def.align === "right" && "text-right",
                        def.align === "center" && "text-center",
                      )}
                      aria-sort={
                        sorted
                          ? sort?.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {def.sortable ? (
                        // A real button so keyboard and assistive-tech
                        // users can sort — a th onClick is mouse-only.
                        <button
                          type="button"
                          onClick={() => toggleSort(key, def)}
                          className="group/sort hover:text-foreground inline-flex cursor-pointer items-center gap-1 select-none"
                        >
                          {def.label}
                          {/* A sortable column says so at rest. The arrow
                              used to appear only once a column WAS sorted,
                              so an unsorted sortable header and a dead one
                              were indistinguishable until you happened to
                              hover one. The neutral glyph is dimmed so a row
                              of them does not shout, and brightens under the
                              cursor.

                              Lucide, not the `↑` / `↓` characters this
                              replaced: those render in the text font at text
                              weight and sat visibly apart from every other
                              icon in the table.

                              `aria-hidden` throughout: `aria-sort` on the
                              `th` already states this to assistive tech. */}
                          {sorted ? (
                            sort?.direction === "asc" ? (
                              <ArrowUp className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3.5" aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown
                              className="size-3.5 opacity-40 transition-opacity group-hover/sort:opacity-100"
                              aria-hidden
                            />
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {def.label}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
                {hasRowActions && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && data.length === 0 ? (
                <SkeletonRows
                  rows={5}
                  cols={
                    visibleCols.length +
                    (hasCheckbox ? 1 : 0) +
                    (hasRowActions ? 1 : 0)
                  }
                />
              ) : data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={
                      visibleCols.length +
                      (hasCheckbox ? 1 : 0) +
                      (hasRowActions ? 1 : 0)
                    }
                    className="p-0"
                  >
                    {props.empty ?? (
                      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Inbox className="size-8 opacity-40" />
                        <p className="text-sm">
                          {props.emptyMessage ??
                            String(
                              tr("alephaTable.empty", {
                                default: "No results.",
                              }),
                            )}
                        </p>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((item) => {
                  const key = rowKey(item);
                  const isSelected = selection.has(key);
                  return (
                    <TableRow
                      key={key}
                      onClick={() => props.onRowClick?.(item)}
                      className={cn(
                        props.onRowClick && "cursor-pointer",
                        isSelected && "bg-muted/30",
                      )}
                    >
                      {hasCheckbox && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(item)}
                            aria-label={tr("alephaTable.selectRow", {
                              default: "Select row",
                            })}
                          />
                        </TableCell>
                      )}
                      {visibleCols.map(([key, def]) => (
                        <TableCell
                          key={key}
                          className={cn(
                            def.className,
                            def.align === "right" && "text-right",
                            def.align === "center" && "text-center",
                          )}
                        >
                          {def.cell(item)}
                        </TableCell>
                      ))}
                      {hasRowActions && (
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowActionsMenu
                            actions={props.rowActions!(item)}
                            item={item}
                            ctx={rowCtx}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* `bg-muted`, paired with the filter bar above — see the note there. */}
        <div className="bg-muted -mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md rounded-t-none border p-2">
          {/* The size picker sits with the count, not in the toolbar above:
              this line already answers "how many, where am I", while the
              toolbar answers "which rows". Mixing the two turns the toolbar
              into a junk drawer. */}
          <div className="flex items-center gap-2">
            {pageSizes.length > 0 && (
              // The same Select the filter bar's controls are built on, not
              // a bare `<select>`: a native control renders in the OS widget
              // set and sat visibly apart from every other trigger in this
              // table. `Control` itself is form-bound, so the picker uses the
              // component underneath it.
              <Select
                value={String(size)}
                onValueChange={(value) => changeSize(Number(value))}
              >
                <SelectTrigger
                  // `bg-background`, because this bar is `bg-muted` and the
                  // trigger is `bg-transparent` by default: on a plain form
                  // surface that blending is right, on a tinted bar it made
                  // the picker read as part of the bar while the pagination
                  // buttons beside it sat on their own plane. Overridden here
                  // rather than in `SelectTrigger`, which every form still
                  // wants transparent.
                  className="bg-background h-7 w-auto gap-1 text-xs"
                  aria-label={String(
                    tr("table.pageSize", { default: "Rows per page" }),
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizes.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-muted-foreground text-xs">
              {meta
                ? `Page ${meta.number + 1}${meta.totalPages ? ` of ${meta.totalPages}` : ""} · ${meta.numberOfElements} of ${meta.totalElements ?? "?"}`
                : "—"}
            </p>
          </div>
          {meta && meta.totalPages && meta.totalPages > 1 ? (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (!meta.isFirst) setPage((p) => Math.max(0, p - 1));
                    }}
                    aria-disabled={meta.isFirst}
                    className={cn(
                      meta.isFirst && "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
                {computePageItems(meta.number + 1, meta.totalPages).map(
                  (item, idx) =>
                    item === "ellipsis" ? (
                      <PaginationItem key={`e-${idx}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          href="#"
                          isActive={item === meta.number + 1}
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(item - 1);
                          }}
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (!meta.isLast) setPage((p) => p + 1);
                    }}
                    aria-disabled={meta.isLast}
                    className={cn(
                      meta.isLast && "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      </div>
    </ClientOnly>
  );
}

function ColumnPicker<T>(props: {
  columns: Record<string, ColumnDef<T>>;
  visible: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { tr } = useI18n();
  const entries = Object.entries(props.columns);
  const label = tr("alephaTable.toggleColumns", {
    default: "Toggle columns",
  });
  return (
    <DropdownMenu>
      {/*
       * The trigger is composed rather than plain: it has to be the dropdown
       * trigger AND the tooltip trigger at once, or this button is the only
       * icon-only control in the toolbar with no tooltip (reset-filters and
       * refresh sit right next to it and both have one).
       *
       * `TooltipTrigger` wraps the rendered element rather than the other way
       * round, matching how `sidebar.tsx` composes the same two primitives.
       * `TooltipProvider` is supplied by the toolbar that renders this.
       */}
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label={label}
                />
              }
            />
          }
        >
          <Columns3 className="size-4" />
        </DropdownMenuTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {tr("alephaTable.columns", { default: "Columns" })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.map(([key, def]) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={props.visible.has(key)}
              closeOnClick={false}
              onCheckedChange={() => props.onToggle(key)}
            >
              {def.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Build the visible page-number sequence with ellipses. Always shows
 * first + last, ±1 around current. Gaps collapse into a single ellipsis.
 * `current` and `total` are 1-indexed.
 */
function computePageItems(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Array<number | "ellipsis"> = [1];
  if (current > 3) items.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) items.push(i);
  if (current < total - 2) items.push("ellipsis");
  items.push(total);
  return items;
}

function SkeletonRows(props: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: props.rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: props.cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function RowActionsMenu<T>(props: {
  actions: RowAction<T>[];
  item: T;
  ctx: RowActionContext;
}) {
  const { tr } = useI18n();
  if (props.actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("alephaTable.openRowActions", {
              default: "Open row actions",
            })}
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.actions.map((action, idx) => {
          const Icon = action.icon;
          const disabled = action.disabled?.(props.item);
          const sep =
            idx > 0 &&
            action.destructive &&
            !props.actions[idx - 1].destructive;
          return (
            <span key={action.label}>
              {sep && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={disabled}
                onClick={() => action.onClick(props.item, props.ctx)}
                className={action.destructive ? "text-destructive" : undefined}
              >
                {Icon && <Icon className="mr-2 size-4" />}
                {action.label}
              </DropdownMenuItem>
            </span>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
