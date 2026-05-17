import type { Page, TObject } from "alepha";
import { useAlepha } from "alepha/react";
import type { FormModel } from "alepha/react/form";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
   * When `true`, column is hidden by default (toggleable later).
   */
  defaultHidden?: boolean;
  className?: string;
  align?: "left" | "right" | "center";
}

export interface RowAction<T> {
  label: string;
  icon?: IconType;
  onClick: (item: T) => void | Promise<void>;
  destructive?: boolean;
  disabled?: (item: T) => boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: IconType;
  onClick: (selected: T[], clearSelection: () => void) => void | Promise<void>;
  destructive?: boolean;
}

export interface AlephaTableProps<T> {
  /**
   * Fetcher invoked with paging + sort. Should return an Alepha `Page<T>`.
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
   * Per-row action menu builder. Return an array of `RowAction` per item.
   */
  rowActions?: (item: T) => RowAction<T>[];
  /**
   * Actions applied to selected rows (enables checkbox column).
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
   * Click handler invoked when a row is clicked (excluding action buttons).
   */
  onRowClick?: (item: T) => void;
  /**
   * Header content rendered above the table (e.g., title + filters).
   */
  header?: ReactNode;
  /**
   * Auto-refresh interval in ms (only when document is visible).
   */
  pollMs?: number;
  /**
   * Filter form. The table refetches whenever the form emits
   * `form:submit:success`, passing `form.currentValues` as `filters` to
   * `fetch`. Row actions can call `form.submit()` after a mutation to
   * refresh the table.
   */
  form?: FormModel<TObject>;
  /**
   * When true, the table also refetches on every `form:change` event
   * (debounced by 250ms) — letting consumers drop the explicit "Apply"
   * button and have filters apply as the user edits them.
   *
   * `form:submit:success` is still honored, so manual submits and
   * `form.submit()` calls still trigger an immediate refresh.
   */
  autoApplyFilters?: boolean;
  /**
   * Extra classes applied to the outer wrapper.
   */
  className?: string;
  /**
   * Message shown when the page is empty. Defaults to "No results".
   */
  emptyMessage?: string;
}

interface SortState {
  field: string;
  direction: "asc" | "desc";
}

const defaultRowKey = (item: unknown): string =>
  String((item as { id?: unknown })?.id ?? Math.random());

export function AlephaTable<T>(props: AlephaTableProps<T>) {
  const rowKey = props.rowKey ?? defaultRowKey;
  const size = props.defaultSize ?? 20;
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const [data, setData] = useState<T[]>([]);
  const [meta, setMeta] = useState<Page<T>["page"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const alepha = useAlepha();
  const form = props.form;

  const sortParam = sort ? `${sort.field},${sort.direction}` : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await props.fetch({
        page,
        size,
        sort: sortParam,
        filters: form?.currentValues,
      });
      setData(res.content);
      setMeta(res.page);
    } finally {
      setLoading(false);
    }
  }, [props.fetch, page, size, sortParam, refreshKey, form]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!form) return;
    return alepha.events.on("form:submit:success", (event) => {
      if (event.id !== form.id) return;
      setPage(0);
      setRefreshKey((k) => k + 1);
    });
  }, [alepha, form]);

  useEffect(() => {
    if (!form || !props.autoApplyFilters) return;
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
  }, [alepha, form, props.autoApplyFilters]);

  useEffect(() => {
    if (!props.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setRefreshKey((k) => k + 1);
    }, props.pollMs);
    return () => clearInterval(id);
  }, [props.pollMs]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const clearSelection = () => setSelection(new Set());

  const selectedItems = useMemo(
    () => data.filter((it) => selection.has(rowKey(it))),
    [data, selection, rowKey],
  );

  const allSelected =
    data.length > 0 && data.every((it) => selection.has(rowKey(it)));
  const someSelected =
    !allSelected && data.some((it) => selection.has(rowKey(it)));

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selection);
      for (const it of data) next.delete(rowKey(it));
      setSelection(next);
    } else {
      const next = new Set(selection);
      for (const it of data) next.add(rowKey(it));
      setSelection(next);
    }
  };

  const toggleRow = (item: T) => {
    const k = rowKey(item);
    const next = new Set(selection);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelection(next);
  };

  const toggleSort = (col: string, def: ColumnDef<T>) => {
    if (!def.sortable) return;
    const field = def.sortKey ?? col;
    setSort((s) => {
      if (!s || s.field !== field) return { field, direction: "asc" };
      if (s.direction === "asc") return { field, direction: "desc" };
      return null;
    });
  };

  const cols = Object.entries(props.columns) as Array<[string, ColumnDef<T>]>;
  const hasCheckbox = Boolean(props.bulkActions?.length);
  const hasRowActions = Boolean(props.rowActions);

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <div className="flex items-center gap-2">
        {props.header && <div className="flex-1 min-w-0">{props.header}</div>}
        {!props.header && <div className="flex-1" />}
        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      {hasCheckbox && selection.size > 0 && (
        <div className="bg-muted/50 flex items-center gap-2 rounded-md border p-2">
          <span className="text-sm">{selection.size} selected</span>
          <div className="flex-1" />
          {props.bulkActions?.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.label}
                variant={action.destructive ? "destructive" : "outline"}
                size="sm"
                onClick={() => action.onClick(selectedItems, clearSelection)}
              >
                {ActionIcon && <ActionIcon className="mr-2 size-4" />}
                {action.label}
              </Button>
            );
          })}
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-auto rounded-md border min-h-0">
        <Table>
          <TableHeader>
            <TableRow>
              {hasCheckbox && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={() => toggleAll()}
                    aria-label="Select all rows"
                  />
                </TableHead>
              )}
              {cols.map(([key, def]) =>
                def.defaultHidden ? null : (
                  <TableHead
                    key={key}
                    className={cn(
                      def.className,
                      def.align === "right" && "text-right",
                      def.align === "center" && "text-center",
                      def.sortable && "cursor-pointer select-none",
                    )}
                    onClick={() => toggleSort(key, def)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {def.label}
                      {def.sortable &&
                        sort?.field === (def.sortKey ?? key) &&
                        (sort.direction === "asc" ? "↑" : "↓")}
                    </span>
                  </TableHead>
                ),
              )}
              {hasRowActions && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              <SkeletonRows
                rows={5}
                cols={
                  cols.length + (hasCheckbox ? 1 : 0) + (hasRowActions ? 1 : 0)
                }
              />
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={
                    cols.length +
                    (hasCheckbox ? 1 : 0) +
                    (hasRowActions ? 1 : 0)
                  }
                  className="text-muted-foreground py-8 text-center"
                >
                  {props.emptyMessage ?? "No results."}
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
                          aria-label="Select row"
                        />
                      </TableCell>
                    )}
                    {cols.map(([key, def]) =>
                      def.defaultHidden ? null : (
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
                      ),
                    )}
                    {hasRowActions && (
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActionsMenu
                          actions={props.rowActions!(item)}
                          item={item}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {meta
            ? `Page ${meta.number + 1}${meta.totalPages ? ` of ${meta.totalPages}` : ""} · ${meta.numberOfElements} of ${meta.totalElements ?? "?"}`
            : "—"}
        </p>
        {meta && meta.totalPages && meta.totalPages > 1 ? (
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationFirst
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!meta.isFirst) setPage(0);
                  }}
                  aria-disabled={meta.isFirst}
                  className={cn(
                    meta.isFirst && "pointer-events-none opacity-50",
                  )}
                />
              </PaginationItem>
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
              <PaginationItem>
                <PaginationLast
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!meta.isLast && meta.totalPages)
                      setPage(meta.totalPages - 1);
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

function RowActionsMenu<T>(props: { actions: RowAction<T>[]; item: T }) {
  if (props.actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open row actions">
          <MoreHorizontal className="size-4" />
        </Button>
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
                onClick={() => action.onClick(props.item)}
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
