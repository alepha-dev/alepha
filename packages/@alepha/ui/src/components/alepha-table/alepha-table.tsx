import * as React from "react";

void React;

import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@alepha/ui/components/ui/context-menu";
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
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { type Page, type ZObject, z } from "alepha";
import { ClientOnly, useAlepha } from "alepha/react";
import { type FormModel, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  EyeOff,
  FunnelX,
  GripVertical,
  Inbox,
  SearchX,
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

import { useIsMobile } from "../../hooks/use-mobile.ts";
import { AlephaTableBulkMenu } from "./alepha-table-bulk-menu.tsx";
import { AlephaTableFilterDialog } from "./alepha-table-filter-dialog.tsx";
import { AlephaTableFilterMenu } from "./alepha-table-filter-menu.tsx";
import { paginateLocal } from "./paginate-local.ts";
import {
  cleanFilterValues,
  queryToFilters,
  shareFiltersUrl,
} from "./query-filters.ts";
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

/**
 * A bulk action that is a button: one click, one handler over the selection.
 */
export interface BulkAction<T> {
  label: string;
  icon?: IconType;
  onClick: (selected: T[], ctx: BulkActionContext) => void | Promise<void>;
  destructive?: boolean;
  /**
   * Whether the action is offered for this selection. Absent means always.
   *
   * Hide, not disable: a disabled button in a three-item pill is a question
   * ("why can't I?"), a missing one is an answer. An action that applies to
   * some of the rows and not others should stay visible and act on the rows
   * it fits, which is what its `onClick` receives the whole selection for.
   */
  visible?: (selected: T[]) => boolean;
}

/**
 * A bulk action that is a MENU: the trigger opens a list of choices, each of
 * them a {@link BulkAction} in its own right, and picking one runs its
 * `onClick` over the selection. For "add to release", "move to column",
 * "assign to": one button cannot carry N targets, and the targets are not
 * known when the table renders.
 *
 * `items` produces the choices, synchronously or not. It is called on open
 * intent (pointer enter, focus, or the menu opening, so keyboard and touch
 * are covered) and its result is kept for the life of the selection: a new
 * selection asks again. Both the pending and the failed state are shown
 * inside the menu, and an empty result renders a disabled "nothing to pick"
 * row rather than an empty popup.
 *
 * A union with {@link BulkAction} rather than an optional `items` on it, so
 * a button cannot also be a menu and a menu cannot also be clicked: the two
 * are told apart by `items` being present.
 *
 * ```tsx
 * const addToRelease: BulkMenuAction<Quest> = {
 *   label: "Add to release",
 *   icon: Flag,
 *   // The closure carries the target, so no item type needs a payload.
 *   items: () =>
 *     releases
 *       .filter((release) => !release.releasedAt)
 *       .map((release) => ({
 *         label: release.tag,
 *         onClick: async (quests, ctx) => {
 *           await Promise.all(
 *             quests.map((quest) => attach(quest.id, release.id)),
 *           );
 *           ctx.refresh();
 *           ctx.clearSelection();
 *         },
 *       })),
 * };
 *
 * <AlephaTable<Quest> bulkActions={[shelve, addToRelease]} />
 * ```
 */
export interface BulkMenuAction<T> {
  label: string;
  icon?: IconType;
  /**
   * Same contract as {@link BulkAction.visible}.
   */
  visible?: (selected: T[]) => boolean;
  /**
   * The choices, produced when the menu is about to open. An async producer
   * shows a loading row until it settles; a rejection shows a failure row and
   * the next open tries again.
   */
  items: () => BulkAction<T>[] | Promise<BulkAction<T>[]>;
}

/**
 * A standalone toolbar action, rendered in the right-hand icon group next to
 * the column picker and separated from the filter area by a divider. Use for
 * table-scoped actions (e.g. "Upload", "New") that aren't tied to a row or a
 * selection.
 *
 * Two forms, chosen per action:
 *
 * - **secondary** (the default): a ghost icon button with the label as its
 *   tooltip, matching the built-in column-picker / refresh controls.
 * - **primary** (`primary: true`): a solid `default` button carrying the icon
 *   AND the visible label. For the page's one main action, typically its
 *   create control: a bare `+` at the same weight as two utility toggles
 *   disappears, and the create button is what a reader looks for first.
 *   No tooltip, since the label is already on screen. Below the `sm`
 *   breakpoint the label collapses to the icon and the button keeps its
 *   primary colour, so it still reads as the action.
 */
export interface TableAction {
  icon: IconType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Render as the table's primary action: a solid labelled button rather
   * than a ghost icon. One per table is the intent; a toolbar with two
   * primary buttons has no primary action.
   */
  primary?: boolean;
}

/**
 * One of the table's two empty states: an icon, a title and a description,
 * centred in the body.
 *
 * Which one is shown is decided by the table, not the caller: a page that
 * came back empty with no filter set means "there is nothing here", and the
 * same page with a filter set means "nothing matched". Those ask the reader
 * for opposite things - create something, or widen the filter - so one
 * sentence for both sends half of them the wrong way. Override the wording
 * per mode, never the choice between them.
 */
export interface AlephaTableEmptyState {
  icon?: IconType;
  title?: ReactNode;
  description?: ReactNode;
  /**
   * A call to action under the description, typically one `<Button>`.
   *
   * A slot rather than a `{ label, onClick }` pair, because the button an
   * empty state wants is rarely just a button: it opens a dialog, it is a
   * `<Link>`, it is disabled while a permission is loading. The table owns the
   * layout and centring and nothing else.
   *
   * Most useful on {@link AlephaTableBaseProps.emptyState}, where "there is
   * nothing here" has an obvious answer - create the first one. The no-match
   * side takes it too, for a "Clear filters" button.
   */
  action?: ReactNode;
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
  /**
   * Fill the filters from the URL query on arrival.
   *
   * `true` reads every param whose name matches a key of `schema`; an array
   * narrows that to the keys it names. Params the schema does not declare are
   * ignored, so the page keeps owning its own (`?tab=`, a locale, a tracking
   * param). Multi-value filters are comma-joined: `?status=new,triaged`.
   *
   * Read once, at mount, and landed in the same slot as {@link seedValues} —
   * above the reader's stored filters, below an explicit `seedValues` the
   * caller passes for a case of its own.
   *
   * ⚠️ **One-directional, and it has to stay that way.** The URL seeds the
   * filters; the filters NEVER write back. Lore's `?view=kanban` was removed
   * for exactly this (#156): an effect that restored a missing param keyed on
   * the router state, which is a global store, so the render on the way *out*
   * of the page saw the next route's query and bounced the reader straight
   * back. A page cannot tell "nobody has chosen yet" from "we are leaving"
   * while the state lives in the URL. The toolbar's Share item is the write
   * side, and it writes to the clipboard on a click, never to the address bar
   * on a keystroke.
   *
   * Off by default. A page's query params are not its table's filters until
   * the page says so.
   */
  fromQuery?: boolean | readonly string[];
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

/**
 * ⚠️ **A page-level action goes INSIDE the table, not above it.**
 *
 * AlephaTable owns a toolbar, and that toolbar is the page's action bar. A
 * "New" button, a picker, an import, an export all belong in it. Putting one
 * in a `CardHeader` above the table produces two stacked bars saying one
 * thing - which is exactly what the epic page's Quests tab looked like until
 * feedback #2006, a hand-rolled header holding a title and an "Attach Quest"
 * button, sitting directly on top of a toolbar holding the column picker and
 * refresh.
 *
 * The rule is written here rather than only on the props because this is
 * where a reader - human or agent - looks first, and the drift comes from
 * not knowing the slot exists rather than from choosing against it.
 *
 * Three slots, and which one is a question about the control, not the action:
 *
 * - `actions` - a button that does something on click. Rendered in the
 *   right-hand icon group beside the column picker: a ghost icon with a
 *   tooltip from its own `label`, or, with `primary: true`, a solid button
 *   showing the label. The page's create action is the `primary` one.
 * - `toolbar` - anything else: a labelled button, a popover trigger, a
 *   segmented control, a group of them. Rendered to the right of the filter
 *   inputs and vertically centred, so it does not have to match their height.
 * - `bulkActions` - operates on the checkbox selection, and only appears
 *   while something is selected. A button, or a menu of them resolved on
 *   demand (`BulkMenuAction`, for "add to release" and its kind).
 *
 * ```tsx
 * <AlephaTable<Quest>
 *   data={quests}
 *   columns={columns}
 *   // A popover trigger: `toolbar`, because it is not an icon button.
 *   toolbar={<QuestPicker onAttach={attach} />}
 *   // Buttons that act on click: `actions`. The create control is `primary`.
 *   actions={[
 *     { icon: Plus, label: "New quest", primary: true, onClick: create },
 *     { icon: Download, label: "Export", onClick: exportAll },
 *   ]}
 * />
 * ```
 *
 * The exception is a control that LEAVES the page - a back link, a tab bar,
 * breadcrumbs. Those are navigation, not actions on this table, and belong
 * where the page's other navigation is.
 */

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
   * Actions applied to selected rows (enables checkbox column). A
   * {@link BulkAction} is a button whose `onClick` receives
   * `(items, { refresh, clearSelection })`; a {@link BulkMenuAction} is a
   * button that opens a menu of such actions, produced on demand.
   */
  bulkActions?: Array<BulkAction<T> | BulkMenuAction<T>>;
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
   *
   * Rows with neither fall back to their position in the current page, which
   * is stable across renders but NOT across sorting or paging - the same row
   * sorted into a different slot becomes a different row as far as React and
   * the selection are concerned. Pass this whenever rows can be selected or
   * hold an inline input and the data has no `id`.
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
   * toolbar — typically a "New" / "Create" button, or any page-level action
   * that is not a bare icon button (see the note on `AlephaTableProps`: it
   * belongs here rather than in a header above the table).
   *
   * Vertically centred in the bar (`self-center`) regardless of its own
   * height, so it no longer has to match the filter inputs. It used to inherit
   * the bar's `items-end`, which meant anything shorter than h-9 hung off the
   * bottom edge and a labelled filter dragged the button down with it.
   */
  toolbar?: ReactNode;
  /**
   * Standalone actions rendered in the toolbar's right-hand icon group,
   * before the column picker and separated from the filter area by a
   * divider. The table renders the button itself, so callers only supply
   * the icon/label/handler: a ghost icon with a tooltip by default, or a
   * solid labelled button when the action is marked `primary`.
   */
  actions?: TableAction[];
  /**
   * Extra classes applied to the outer wrapper.
   */
  className?: string;
  /**
   * Title shown in both empty states, replacing their defaults.
   *
   * Kept as the one-line escape hatch it has always been, so it also
   * suppresses the default description: a caller who wrote the whole message
   * in here does not want "Nothing here yet." underneath it. For a title AND
   * a description, or for wording that differs between the two states, use
   * {@link emptyState} and {@link noMatchState}.
   */
  emptyMessage?: string;
  /**
   * The empty state shown when the page came back empty and NO filter is set.
   * Defaults to an inbox icon, "No items" and "Nothing here yet.".
   */
  emptyState?: AlephaTableEmptyState;
  /**
   * The empty state shown when the page came back empty and at least one
   * filter IS set. Defaults to a struck-through search icon, "No match" and
   * "Try adjusting or clearing the filters.".
   *
   * Only reachable when `filters` is set: with no filter form there is
   * nothing to be filtered by, so an empty page can only mean {@link
   * emptyState}.
   */
  noMatchState?: AlephaTableEmptyState;
  /**
   * Rich empty-state node rendered when the page is empty — e.g. an icon +
   * message + optional call-to-action. Replaces the whole thing, both states
   * included, so it outranks every prop above.
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

const EMPTY_FILTERS_SCHEMA = z.object({}) as ZObject;

/**
 * Synchronous localStorage read. Returns undefined on miss or error.
 */
const readPersisted = <V,>(key: string, suffix: string): V | undefined => {
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
const reconcilePersistedFilters = (
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

/**
 * The three persisted preferences, read for one `persistenceKey`.
 *
 * Factored out because they are read from TWO places now: once at mount, and
 * again whenever the key changes under a mounted table. Inline in `useState`
 * they could only be read once, and a second copy of each rule is how the
 * scope-change path would come to disagree with the mount path about what a
 * stored value means.
 */
const persistedSort = (
  key: string | undefined,
  fallback: SortState | null | undefined,
): SortState | null => {
  const stored = key ? readPersisted<SortState>(key, "sort") : undefined;
  return stored ?? fallback ?? null;
};

const persistedSize = (
  key: string | undefined,
  fallback: number | undefined,
): number => {
  const stored = key ? readPersisted<number>(key, "size") : undefined;
  return stored ?? fallback ?? 20;
};

const persistedColumns = <T,>(
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
const reconcileOrder = (
  stored: string[] | undefined,
  declared: string[],
): string[] => {
  if (!stored) return declared;
  const known = new Set(declared);
  const kept = stored.filter((key) => known.has(key));
  const seen = new Set(kept);
  return [...kept, ...declared.filter((key) => !seen.has(key))];
};

const persistedOrder = <T,>(
  key: string | undefined,
  columns: Record<string, ColumnDef<T>>,
): string[] =>
  reconcileOrder(
    key ? readPersisted<string[]>(key, "columnOrder") : undefined,
    Object.keys(columns),
  );

export function AlephaTable<T>(props: AlephaTableProps<T>) {
  // State, not a constant. It was `props.defaultSize ?? 20` read once, so a
  // reader had no way to see more rows than the call site had decided for
  // them. Already in `load`'s dependency array, so changing it refetches.
  const [size, setSize] = useState<number>(() =>
    persistedSize(props.persistenceKey, props.defaultSize),
  );
  const pageSizes = props.pageSizes ?? PAGE_SIZES;
  const alepha = useAlepha();
  const { tr } = useI18n();
  const toast = useToast();
  /**
   * The whole of the phone layout, and deliberately one switch rather than a
   * scattering of `max-md:` classes: the filter controls have to be rendered
   * in exactly ONE of the two places (see `AlephaTableFilterDialog`), which
   * CSS cannot express. Everything else below the breakpoint follows the same
   * flag so the two halves of the layout cannot disagree.
   *
   * Safe against hydration because the whole table sits inside `ClientOnly`,
   * and `useIsMobile` reads the same `MediaQueryList` it subscribes to.
   */
  const isMobile = useIsMobile();

  // -- Filter form (internal when `filters` is set, else legacy `form`) -----

  // Read persisted filter values synchronously so they reach useForm's
  // first invocation. Reading inside an effect would be too late —
  // useForm captures `initialValues` only once via useMemo.
  const persistedFilterValues = useMemo(() => {
    if (!props.persistenceKey || !props.filters) return undefined;
    return reconcilePersistedFilters(
      props.filters.schema,
      readPersisted<Record<string, any>>(props.persistenceKey, "filters"),
    );
  }, [props.persistenceKey, props.filters]);

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
    persistedSort(props.persistenceKey, props.defaultSort),
  );
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

  /**
   * Copy a link that opens this table with these filters.
   *
   * The write half of `fromQuery`, and the only one: nothing puts the
   * filters in the address bar as the reader types, so a link out of a
   * filtered table has to be asked for. Built on the page's own URL, so the
   * params the page owns travel with it.
   */
  /**
   * Whether a link out of this table would do anything on arrival.
   *
   * A table that does not read the query back would copy a URL whose params
   * are inert, which is worse than no Share at all: it looks like it worked.
   */
  const canShare = Boolean(props.filters?.fromQuery);

  const shareFilters = useCallback(async () => {
    if (!props.filters || !form) return;
    const url = shareFiltersUrl(
      window.location.href,
      Object.keys(z.schema.shape(props.filters.schema)),
      cleanFilterValues(form.currentValues ?? {}),
    );
    try {
      await navigator.clipboard.writeText(url);
      toast.success(
        tr("alephaTable.shareFiltersCopied", { default: "Link copied" }),
      );
    } catch {
      // A denied clipboard permission, or an insecure origin. Nothing here
      // is worth an error toast the reader cannot act on.
    }
  }, [form, props.filters, toast, tr]);

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
      writePersisted(
        props.persistenceKey!,
        "filters",
        cleanFilterValues(form.currentValues ?? {}),
      );
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
        // oxlint-disable-next-line typescript/no-base-to-string
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

  // -- Column visibility -----------------------------------------------------

  const allColumnKeys = useMemo(
    () => Object.keys(props.columns),
    [props.columns],
  );

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    persistedColumns(props.persistenceKey, props.columns),
  );

  /**
   * The reader's column order. Held as the raw preference and reconciled on
   * every read below, so a caller adding a column at runtime is handled by
   * the same code path as a stale stored array.
   */
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    persistedOrder(props.persistenceKey, props.columns),
  );

  const orderedKeys = useMemo(
    () => reconcileOrder(columnOrder, allColumnKeys),
    [columnOrder, allColumnKeys],
  );

  /**
   * Move one column one slot, within the VISIBLE sequence.
   *
   * Over the visible columns and not the full order, because nudging a column
   * past a hidden one would look like nothing happened - the reader would
   * press "move left" and see the table unchanged. A swap rather than a
   * splice, so the hidden columns between the two keep their places.
   */
  const moveColumn = (key: string, delta: -1 | 1) => {
    const visible = orderedKeys.filter((k) => visibleColumns.has(k));
    const at = visible.indexOf(key);
    const target = visible[at + delta];
    if (at < 0 || target === undefined) return;
    const next = [...orderedKeys];
    const from = next.indexOf(key);
    const to = next.indexOf(target);
    next[from] = target;
    next[to] = key;
    commitOrder(next);
    // Announced, or the change is silent for a screen reader: nothing else
    // about a reordered table is spoken.
    setOrderAnnouncement(
      String(
        tr("alephaTable.columnMoved", {
          default: `${String(props.columns[key]?.label ?? key)} moved to position ${at + delta + 1} of ${visible.length}`,
          args: [
            String(props.columns[key]?.label ?? key),
            String(at + delta + 1),
            String(visible.length),
          ],
        }),
      ),
    );
  };

  /**
   * Drop `key` onto `target`'s slot, which is what a drag in the column
   * picker means. Unlike {@link moveColumn} this walks the FULL order: the
   * picker lists hidden columns too, so a drag there can legitimately cross
   * one.
   */
  const reorderColumn = (key: string, target: string) => {
    if (key === target) return;
    const next = orderedKeys.filter((k) => k !== key);
    next.splice(next.indexOf(target), 0, key);
    commitOrder(next);
  };

  const commitOrder = (next: string[]) => {
    setColumnOrder(next);
    if (props.persistenceKey) {
      writePersisted(props.persistenceKey, "columnOrder", next);
    }
  };

  /**
   * What the live region says after a move. Cleared and re-set on each one,
   * so two moves in a row are both announced.
   */
  const [orderAnnouncement, setOrderAnnouncement] = useState("");

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
   * The sort and columns effects below are keyed on `persistenceKey` too, so
   * on the render where it changes they would fire in the same flush and
   * write the OUTGOING scope's state under the INCOMING key - silently
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
    setSize(persistedSize(props.persistenceKey, props.defaultSize));
    setSort(persistedSort(props.persistenceKey, props.defaultSort));
    setVisibleColumns(persistedColumns(props.persistenceKey, props.columns));
    // Same render pass as the rest, and for the identical reason: the effects
    // keyed on `persistenceKey` fire in one flush, so an order left behind
    // here would be written back under the INCOMING key.
    setColumnOrder(persistedOrder(props.persistenceKey, props.columns));
    setRefreshKey((k) => k + 1);
  }

  /**
   * Written on a TOGGLE, never on mount - the same rule the filter-persist
   * effect follows above, and for the same reason.
   *
   * As a mount effect this stamped the current set into storage on first
   * paint, which froze the column layout of every reader who had merely
   * OPENED the table. A `defaultHidden` added to a column afterwards then did
   * nothing for them, permanently and with no way to notice: the stored set
   * had no `defaultHidden` in it to be out of date. It also made
   * `defaultHidden` unusable as a controlled prop, since a remount read back
   * what the previous mount had written rather than the new default.
   */
  const toggleColumn = (id: string) => {
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleColumns(next);
    if (props.persistenceKey) {
      writePersisted(props.persistenceKey, "columns", [...next]);
    }
  };

  // -- Render ---------------------------------------------------------------

  // The reader's order, not the declaration's.
  const cols = orderedKeys.map((key) => [key, props.columns[key]!]) as Array<
    [string, ColumnDef<T>]
  >;
  const visibleCols = cols.filter(([key]) => visibleColumns.has(key));
  const hasCheckbox = Boolean(props.bulkActions?.length);
  const hasRowActions = Boolean(props.rowActions);

  const rowCtx: RowActionContext = useMemo(() => ({ refresh }), [refresh]);
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

  // Which empty state applies, resolved here rather than in the JSX because
  // the answer is one boolean and the branch is four values deep.
  //
  // `hasActiveFilters` is already false whenever `props.filters` is unset, so
  // a table with no filter form can only ever reach the "no items" side.
  const emptyOverride =
    (hasActiveFilters ? props.noMatchState : props.emptyState) ?? {};
  const EmptyIcon = emptyOverride.icon ?? (hasActiveFilters ? SearchX : Inbox);
  const emptyTitle =
    emptyOverride.title ??
    props.emptyMessage ??
    String(
      hasActiveFilters
        ? tr("alephaTable.noMatchTitle", { default: "No match" })
        : tr("alephaTable.emptyTitle", { default: "No items" }),
    );
  // Suppressed by a bare `emptyMessage`: that prop is the whole message, and
  // pairing someone's "No artifacts yet" with a stock second line reads as a
  // component talking over its caller.
  // The empty state is showing, as opposed to the skeleton that also renders
  // on `data.length === 0`. Read by the `<Table>` height as well as the body,
  // so the two cannot disagree.
  const isEmptyState = !loading && data.length === 0;
  const emptyAction = emptyOverride.action;
  const emptyDescription =
    emptyOverride.description ??
    (props.emptyMessage
      ? undefined
      : String(
          hasActiveFilters
            ? tr("alephaTable.noMatchDescription", {
                default: "Try adjusting or clearing the filters.",
              })
            : tr("alephaTable.emptyDescription", {
                default: "Nothing here yet.",
              }),
        ));

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
          // The `--bevel` line, laid just inside the bar's own top border,
          // the same fold the header and the footer carry. This one is the
          // top edge of the whole table block, so it is the one that decides
          // whether the block sits ON the page or IN it.
          <div className="bg-muted [&_:is(input,[role=combobox])]:bg-background dark:[&_:is(input,[role=combobox])]:bg-background flex flex-wrap items-end gap-2 rounded-md rounded-b-none border p-2 shadow-[inset_0_1px_0_0_var(--bevel)]">
            {props.filters && form && !isMobile ? (
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
                      if (action.primary) {
                        // The visible label is the tooltip, so there is
                        // none. `aria-label` keeps the accessible name once
                        // the label collapses below `sm`; `h-9` lines the
                        // button up with the ghost icons beside it.
                        return (
                          <Button
                            key={action.label}
                            type="button"
                            size="sm"
                            className="h-9 px-3"
                            aria-label={action.label}
                            disabled={action.disabled}
                            onClick={action.onClick}
                          >
                            <ActionIcon className="size-4" />
                            <span className="hidden sm:inline">
                              {action.label}
                            </span>
                          </Button>
                        );
                      }
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
                {isMobile && props.filters && form && (
                  <AlephaTableFilterDialog
                    form={form}
                    activeCount={activeFilterCount}
                    onReset={resetFilters}
                    onShare={canShare ? shareFilters : undefined}
                  >
                    {props.filters.render(form)}
                  </AlephaTableFilterDialog>
                )}
                {showColumnPicker && (
                  <ColumnPicker<T>
                    columns={props.columns}
                    order={orderedKeys}
                    visible={visibleColumns}
                    onToggle={toggleColumn}
                    onReorder={reorderColumn}
                  />
                )}
                {/*
                  Desktop only. On a phone the same two actions live in the
                  filter dialog, beside the controls they act on, and a second
                  copy out here would spend a slot of the very row that dialog
                  exists to shorten.
                */}
                {showActionsMenu && props.filters && !isMobile && canShare && (
                  <AlephaTableFilterMenu
                    activeCount={activeFilterCount}
                    onShare={shareFilters}
                    onReset={resetFilters}
                  />
                )}
                {/*
                  Not linkable: no Share, so no menu either. A menu of one
                  item would cost a click to reach the button that is already
                  here.
                */}
                {showActionsMenu && props.filters && !isMobile && !canShare && (
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
          selection.size > 0 &&
          visibleBulkActions.length > 0 && (
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
                {visibleBulkActions.map((action) => {
                  if ("items" in action) {
                    return (
                      <AlephaTableBulkMenu<T>
                        key={action.label}
                        action={action}
                        selected={selectedItems}
                        ctx={bulkCtx}
                      />
                    );
                  }
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
            // shadcn's `<Table>` wraps the table in a container div whose
            // classes it hardcodes, and `scripts/sync.ts` overwrites that file
            // wholesale - so the one class it needs is set from out here
            // instead, where sync cannot reach.
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
            <TableHeader className="bg-muted sticky top-0 z-10 shadow-[inset_0_1px_0_0_var(--bevel),inset_0_-1px_0_0_var(--border)]">
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
                {visibleCols.map(([key, def], index) => {
                  const sorted =
                    def.sortable && sort?.field === (def.sortKey ?? key);
                  return (
                    // ⚠️ The menu is on the HEADER and never on a body cell.
                    // Overriding the browser's own menu is acceptable on
                    // chrome; on a data cell it breaks copy, and people copy
                    // cell values constantly.
                    <ContextMenu key={key}>
                      <ContextMenuTrigger
                        render={
                          <TableHead
                            // Focusable so Shift+F10 reaches the menu.
                            // Without it the menu is mouse-only, and
                            // right-click is already invisible and absent on
                            // touch - which is exactly why the column picker
                            // and not this is the primary path.
                            tabIndex={0}
                            className={cn(
                              def.className,
                              "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
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
                          />
                        }
                      >
                        {def.sortable ? (
                          // A real button so keyboard and assistive-tech
                          // users can sort — a th onClick is mouse-only.
                          <button
                            type="button"
                            onClick={() => toggleSort(key, def)}
                            className="group/sort hover:text-foreground inline-flex items-center gap-1 select-none"
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
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {/* Explicit directions rather than the header's
                            click-cycling, which is the one item here that
                            beats the affordance it duplicates: cycling makes
                            you guess which of three states you are in.
                            Hidden entirely on a column that cannot sort,
                            rather than shown disabled - a permanently dead
                            entry on half the columns is noise. */}
                        {def.sortable && (
                          <>
                            <ContextMenuItem
                              onClick={() => setSortTo(key, def, "asc")}
                            >
                              <ArrowUpAZ className="size-4" />
                              {tr("alephaTable.sortAsc", {
                                default: "Sort ascending",
                              })}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => setSortTo(key, def, "desc")}
                            >
                              <ArrowDownAZ className="size-4" />
                              {tr("alephaTable.sortDesc", {
                                default: "Sort descending",
                              })}
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={!sorted}
                              onClick={() => setSortTo(key, def, null)}
                            >
                              {tr("alephaTable.sortClear", {
                                default: "Clear sort",
                              })}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                          </>
                        )}
                        {/* Disabled at the ends rather than hidden: the pair
                            is a fixed landmark, and an entry that appears
                            and disappears as you move a column is harder to
                            aim at than one that greys out. */}
                        <ContextMenuItem
                          disabled={index === 0}
                          onClick={() => moveColumn(key, -1)}
                        >
                          <ChevronLeft className="size-4" />
                          {tr("alephaTable.moveLeft", { default: "Move left" })}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={index === visibleCols.length - 1}
                          onClick={() => moveColumn(key, 1)}
                        >
                          <ChevronRight className="size-4" />
                          {tr("alephaTable.moveRight", {
                            default: "Move right",
                          })}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        {/* Never the last one: a table with no columns has
                            no way back to this menu. */}
                        <ContextMenuItem
                          disabled={visibleCols.length <= 1}
                          onClick={() => toggleColumn(key)}
                        >
                          <EyeOff className="size-4" />
                          {tr("alephaTable.hideColumn", {
                            default: "Hide column",
                          })}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
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
                    // `h-full` and the cell's inherited `align-middle` are
                    // what centre the state vertically. The chain is three
                    // links long and every one is load-bearing: the scroller
                    // above grows to the container, the `<table>` takes its
                    // height, and this - the only body row - takes what the
                    // header leaves. Break any of them and the state sits
                    // tucked under the header instead of in the middle.
                    //
                    // `whitespace-normal` undoes the `whitespace-nowrap` every
                    // cell carries, which is right for a data cell and wrong
                    // for a sentence: the description would run off the side
                    // and widen the table's own horizontal scroller.
                    className="h-full p-0 whitespace-normal"
                  >
                    {props.empty ?? (
                      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                        <EmptyIcon className="text-muted-foreground size-8 opacity-40" />
                        <p className="text-foreground text-sm font-medium">
                          {emptyTitle}
                        </p>
                        {emptyDescription ? (
                          <p className="text-muted-foreground max-w-xs text-sm text-balance">
                            {emptyDescription}
                          </p>
                        ) : null}
                        {/* `pt-2` on top of the block's `gap-2`: the action is
                            a separate beat from the sentence explaining it,
                            and at one gap it reads as a third line of text. */}
                        {emptyAction ? (
                          <div className="pt-2">{emptyAction}</div>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((item, rowIndex) => {
                  const key = rowKeys[rowIndex];
                  const isSelected = selection.has(key);
                  return (
                    <TableRow
                      key={key}
                      onClick={() => props.onRowClick?.(item)}
                      className={cn(
                        // Stays: the global cursor rule in `styles.css` covers
                        // controls and menu items, and a `<tr>` is neither. It
                        // is also conditional, which no blanket rule could be -
                        // a row is only clickable when a handler was given.
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

        {/* A move is otherwise silent: nothing about a reordered table is
            spoken, and the visual change is the only feedback. Outside the
            table so it is not read as a cell. */}
        <span aria-live="polite" className="sr-only">
          {orderAnnouncement}
        </span>

        {/* `bg-muted`, paired with the filter bar above, see the note there.
            Carries the same `--bevel` fold under its top border: the three
            chrome bands (filter bar, header, footer) are lit from one side, so
            they read as the same material at three different heights. */}
        <div className="bg-muted -mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md rounded-t-none border p-2 shadow-[inset_0_1px_0_0_var(--bevel)]">
          {/* The size picker sits with the count, not in the toolbar above:
              this line already answers "how many, where am I", while the
              toolbar answers "which rows". Mixing the two turns the toolbar
              into a junk drawer. */}
          <div className="flex items-center gap-2">
            {/*
              Hidden on a phone, and the size itself is untouched: `size` is
              persisted per table, so a reader who chose 50 on a desktop keeps
              50 here — this drops the CONTROL, not the setting. Nobody picks
              100 rows on a 412px screen, and the picker plus the range text
              plus the numbered pages is exactly what made this bar wrap onto
              three lines (feedback #2106).
            */}
            {pageSizes.length > 0 &&
              !isMobile && (
                // The same `Control` the filter bar is built on, so the picker
                // is one component with every other select in this table. It
                // used to be the raw `Select` underneath it, because `Control`
                // is form-bound and this is not a form — `sizeForm` above is
                // what closes that gap.
                <Control
                  input={sizeForm.input.size}
                  // The count line beside it is not a label, so the trigger has
                  // to name itself.
                  label=""
                  inputProps={{
                    "aria-label": String(
                      tr("table.pageSize", { default: "Rows per page" }),
                    ),
                  }}
                  // `bg-background`, because this bar is `bg-muted` and the
                  // trigger is `bg-transparent` by default: on a plain form
                  // surface that blending is right, on a tinted bar it made the
                  // picker read as part of the bar while the pagination buttons
                  // beside it sat on their own plane. Set here rather than on
                  // the trigger itself, which every form still wants
                  // transparent.
                  triggerClassName="bg-background h-7 w-auto gap-1 text-xs"
                  items={pageSizes.map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
              )}
            <p className="text-muted-foreground text-xs">
              {meta
                ? // The row range is the half that goes on a phone: "where am
                  // I" survives, "how many of how many" does not, and the two
                  // together are what pushed this past one line.
                  `Page ${meta.number + 1}${meta.totalPages ? ` of ${meta.totalPages}` : ""}${
                    isMobile
                      ? ""
                      : ` · ${meta.numberOfElements} of ${meta.totalElements ?? "?"}`
                  }`
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
                {/*
                  Previous/next only on a phone. The numbered sequence is up
                  to seven tap targets plus two ellipses, which is the widest
                  thing in this bar, and "Page 1 of 3" beside it already says
                  where the reader is. Their labels are `hidden sm:block` in
                  the primitive, so the two that remain are bare chevrons.
                */}
                {!isMobile &&
                  computePageItems(meta.number + 1, meta.totalPages).map(
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

/**
 * The single home for column state: what is shown, and in what order.
 *
 * Both live here rather than order being reachable only from the header's
 * context menu, and that is the shape decision. Right-click advertises
 * nothing and does not exist on touch, so a feature reachable only that way
 * is one most people never find. The menu is a fast path into this.
 *
 * Reordering is native HTML5 drag, the way Lore's folio tree does it: this
 * package has no drag-and-drop dependency and a column list is not worth
 * adding one. The arrows beside each row are not a fallback for a broken
 * drag - they are the keyboard and touch path, where drag does not exist.
 */
function ColumnPicker<T>(props: {
  columns: Record<string, ColumnDef<T>>;
  order: string[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  onReorder: (key: string, target: string) => void;
}) {
  const { tr } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  // The reader's order, so the list reads like the table it controls.
  const entries = props.order.map(
    (key) => [key, props.columns[key]!] as [string, ColumnDef<T>],
  );
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
          {entries.map(([key, def], index) => (
            <div
              key={key}
              draggable
              onDragStart={() => setDragging(key)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                // Required, or the drop never fires.
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging !== key)
                  props.onReorder(dragging, key);
                setDragging(null);
              }}
              className={cn(
                "flex items-center gap-1 pr-1",
                dragging === key && "opacity-45",
              )}
            >
              <GripVertical
                className="text-muted-foreground/60 size-3.5 shrink-0 cursor-grab"
                aria-hidden
              />
              <DropdownMenuCheckboxItem
                checked={props.visible.has(key)}
                closeOnClick={false}
                onCheckedChange={() => props.onToggle(key)}
                className="flex-1"
              >
                {def.label}
              </DropdownMenuCheckboxItem>
              {/* Keyboard and touch reach the order here. A drag handle alone
                  would put reordering out of reach for both. */}
              <button
                type="button"
                disabled={index === 0}
                aria-label={String(
                  tr("alephaTable.moveUp", { default: "Move up" }),
                )}
                onClick={() => props.onReorder(key, entries[index - 1]![0])}
                className="text-muted-foreground/60 hover:text-foreground rounded p-0.5 disabled:opacity-30"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={index === entries.length - 1}
                aria-label={String(
                  tr("alephaTable.moveDown", { default: "Move down" }),
                )}
                onClick={() => props.onReorder(entries[index + 1]![0], key)}
                className="text-muted-foreground/60 hover:text-foreground rounded p-0.5 disabled:opacity-30"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
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

const SkeletonRows = (props: { rows: number; cols: number }) => {
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
};

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
                variant={action.destructive ? "destructive" : undefined}
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
