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
  render: (form: FormModel<ZObject>) => ReactNode;
}

interface SortState {
  field: string;
  direction: "asc" | "desc";
}

export interface AlephaTableProps<T> {
  /**
   * Fetcher invoked with paging + sort + filters. Should return an
   * Alepha `Page<T>`.
   */
  fetch: (params: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }) => Promise<Page<T>>;
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
   * Default page size.
   */
  defaultSize?: number;
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
   */
  pollMs?: number;
  /**
   * External refetch trigger. Bump this value (e.g. from a `useState`
   * counter) after a mutation performed *outside* the table — such as a
   * toolbar upload action — to make the table reload. Row/bulk actions
   * already get `ctx.refresh()`; this is the escape hatch for everything
   * else. Changing it resets to page 0 and refetches; the initial value
   * is ignored (the table fetches on mount regardless).
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

export function AlephaTable<T>(props: AlephaTableProps<T>) {
  const rowKey = props.rowKey ?? defaultRowKey;
  const size = props.defaultSize ?? 20;
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
      ...(props.filters?.initialValues ?? {}),
      ...(persistedFilterValues ?? {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [sort, setSort] = useState<SortState | null>(() => {
    if (props.persistenceKey) {
      const persisted = readPersisted<SortState>(props.persistenceKey, "sort");
      if (persisted) return persisted;
    }
    return props.defaultSort ?? null;
  });
  const [data, setData] = useState<T[]>([]);
  const [meta, setMeta] = useState<Page<T>["page"] | null>(null);
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
    setLoading(true);
    try {
      const res = await fetchRef.current({
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
          <div className="bg-muted flex flex-wrap items-end gap-2 rounded-md rounded-b-none border p-2 [&_:is(input,[role=combobox])]:bg-background dark:[&_:is(input,[role=combobox])]:bg-background">
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
            {props.toolbar}
            <TooltipProvider>
              <div className="flex items-end gap-1">
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

        {hasCheckbox && selection.size > 0 && (
          // Linear-style floating action pill: fixed at the bottom-center of
          // the viewport, dark surface that stays readable in both themes
          // because the colors are hard-coded (theme-relative `bg-foreground`
          // inverts awkwardly against a white container in dark mode).
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
            <div className="pointer-events-auto flex animate-in fade-in-0 slide-in-from-bottom-2 items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-zinc-100 shadow-lg ring-1 ring-white/10 duration-150">
              <span className="text-sm pl-2">
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
            <TableHeader className="bg-background sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
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
                          className="hover:text-foreground inline-flex cursor-pointer select-none items-center gap-1"
                        >
                          {def.label}
                          {sorted && (
                            <span aria-hidden>
                              {sort?.direction === "asc" ? "↑" : "↓"}
                            </span>
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
          <p className="text-muted-foreground text-xs">
            {meta
              ? `Page ${meta.number + 1}${meta.totalPages ? ` of ${meta.totalPages}` : ""} · ${meta.numberOfElements} of ${meta.totalElements ?? "?"}`
              : "—"}
          </p>
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
