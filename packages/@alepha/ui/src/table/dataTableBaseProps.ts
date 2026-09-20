import type { ReactNode } from "react";

import type { DataTableCellPadding } from "./dataTableCellPadding.ts";
import type { DataTableSquareRight } from "./dataTableSquareRight.ts";
import type {
  DataTableEmptyState,
  DataTableFilterFields,
  DataTableFilters,
  DataTableNoFilterFields,
  DataTablePersistedFacets,
  DataTableSummary,
  BulkAction,
  BulkMenuAction,
  ColumnDef,
  RowActionEntry,
  SortState,
  TableAction,
} from "./dataTableTypes.ts";

/**
 * ⚠️ **A page-level action goes INSIDE the table, not above it.**
 *
 * DataTable owns a toolbar, and that toolbar is the page's action bar. A
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
 * <DataTable<Quest>
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
 *
 * The same goes for what a page SAYS about its list. Totals go in `summary`,
 * the collapsible band of stat cards at the top of the table, and an
 * explanation goes in `help`, the `?` at the end of the icon group: not a row
 * of tiles and an alert stacked above the table, outside its frame, where they
 * cannot follow its filters and cannot be put away.
 */

export interface DataTableBaseProps<
  T,
  F extends DataTableFilterFields = DataTableNoFilterFields,
> {
  /**
   * Column definitions, keyed by the property name they read from.
   */
  columns: Record<string, ColumnDef<T>>;
  /**
   * Per-row action menu builder. Return an array of `RowAction` per
   * item. Each `onClick` receives `(item, { refresh, clearSelection })`.
   *
   * An entry may also be a {@link RowActionGroup}: a label, an icon and
   * the actions it holds, rendered as a submenu one level deep.
   */
  rowActions?: (item: T) => RowActionEntry<T>[];
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
   * not the reader's business. The size is then {@link defaultSize}, always:
   * a size the reader stored before the picker went is not restored.
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
   * Pointer handler invoked with the row under the pointer, and with
   * `undefined` when the pointer leaves the body.
   *
   * For a surface BESIDE the table that narrows to the row being pointed at.
   * It is not a selection and it must not drive one - the pointer leaves on
   * its own, and anything that survives that should be a click.
   *
   * ⚠️ Pointer only, so whatever it drives has to be reachable another way:
   * a keyboard reader never fires it, and neither does a touch reader.
   */
  onRowHover?: (item: T | undefined) => void;
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
   * The table's filters, as a record of fields. DataTable owns the form,
   * draws the fields on its filter bar in the toolbar (behind a dialog on a
   * phone), and refetches as they change. See {@link DataTableFilters} for
   * the call-site form, the modes and what is remembered.
   */
  filters?: DataTableFilters<F>;
  /**
   * When set, filter values, the filters on the bar, column visibility, and
   * sort state are persisted to `localStorage` under this key. Pick a key that's
   * unique per page and per scope (e.g. `"admin.users"`,
   * `\`lor.board.${campaignId}\``).
   *
   * Narrow what it stores with {@link persist}.
   */
  persistenceKey?: string;
  /**
   * Which facets {@link persistenceKey} stores. All three by default, so this
   * is only ever worth passing to turn one OFF.
   *
   * The case it exists for: a list whose column layout is worth remembering
   * and whose filters are not. Lore's Apps page had to give up persistence
   * entirely to avoid opening narrowed by last week's search, because the
   * three were one switch.
   *
   * Ignored without a `persistenceKey`, which stores nothing either way.
   */
  persist?: DataTablePersistedFacets;
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
   * that is not a bare icon button (see the note on `DataTableProps`: it
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
   * The collapsible summary panel at the top of the table, above the filter
   * bar: a grid of stat cards, given or fetched with the table's filters, and
   * any node under them. See {@link DataTableSummary}.
   *
   * Open by default. The reader's open or closed choice is stored under
   * {@link persistenceKey}, like the page size.
   *
   * ```tsx
   * <DataTable<Order, typeof filterFields>
   *   fetch={fetchOrders}
   *   filters={{ fields: filterFields }}
   *   summary={{
   *     // Called with the filters the rows answer, on every reload of the
   *     // set: the totals describe the filtered list, not the page.
   *     fetch: async ({ filters, signal }) => {
   *       const stats = await client.getOrderStats(
   *         { query: { status: filters?.status } },
   *         { request: { signal } },
   *       );
   *       return [
   *         { label: "Orders", value: l(stats.count), icon: ShoppingCart },
   *         { label: "Revenue", value: money(stats.totalCents) },
   *         {
   *           label: "Refunded",
   *           value: l(stats.refunded),
   *           hint: money(stats.refundedCents),
   *           tone: stats.refunded > 0 ? "warning" : undefined,
   *         },
   *       ];
   *     },
   *     // Anything that is not a figure, under the cards.
   *     content: <OrdersChart />,
   *   }}
   *   columns={columns}
   * />
   * ```
   *
   * Static figures go in `cards` instead of `fetch`; a node alone goes in
   * `content`. With nothing to show (no card and no content) the panel is not
   * drawn at all.
   */
  summary?: DataTableSummary<F>;
  /**
   * The page's explanation, behind a `?` icon at the end of the toolbar's icon
   * group, after refresh. It opens a hover card on hover, on keyboard focus
   * and on a click or a tap, and the card stays open while the pointer moves
   * into it, so a link inside it can be followed.
   *
   * For what a reader needs once and then not again: how the list is built,
   * why a row cannot be edited, what a status means.
   *
   * ```tsx
   * <DataTable<Sale>
   *   fetch={fetchSales}
   *   help={
   *     <>
   *       <p className="font-medium">A locked journal</p>
   *       <p className="text-muted-foreground">
   *         Every payment is written once. A mistake is corrected by a
   *         reversing entry, and each entry is fingerprinted.
   *       </p>
   *     </>
   *   }
   *   columns={columns}
   * />
   * ```
   */
  help?: ReactNode;
  /**
   * Extra classes applied to the outer wrapper.
   */
  className?: string;
  /**
   * Extra classes applied to the table's chrome bands: the summary panel and
   * the filter bar above, the sticky column header and the pagination footer
   * below.
   *
   * Merged after their own classes, so a background here replaces their
   * default `bg-muted`: `chromeClassName="bg-transparent"` lets the
   * surface the table sits on show through.
   *
   * ⚠️ The column header is sticky, and a translucent one lets the rows
   * scroll visibly through its labels. Prefer an opaque background on a
   * table long enough to scroll.
   */
  chromeClassName?: string;
  /**
   * Square the table's right corners, for a table that another panel joins
   * on its right so the two read as one block: the panel carries the
   * rounded corners, and the table's right border is the line between them.
   *
   * `true` squares them always. A breakpoint (`"lg"`) squares them from that
   * width up only, for a panel that is itself hidden below it: the table on
   * its own keeps its rounded corners.
   */
  squareRight?: DataTableSquareRight;
  /**
   * Drop the table's own outer frame: no rounded corners, and no border on
   * the left, right, top or bottom of the toolbar, the rows or the footer.
   * The lines BETWEEN them stay, since those separate the table's own bands.
   *
   * For a table laid flush inside a frame something else draws - a page
   * whose gutters are its rules, a pane with its own border - where the
   * table's own edge would be a second line one pixel from the first.
   *
   * @default false
   */
  flat?: boolean;
  /**
   * How much room the cells give their content: `small`, `normal` (the
   * default, the `Table` primitives' own padding) or `large`. Applies to the
   * header, the rows and the loading skeleton alike. A column's own
   * `className` still wins over it.
   */
  cellPadding?: DataTableCellPadding;
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
  emptyState?: DataTableEmptyState;
  /**
   * The empty state shown when the page came back empty and at least one
   * filter IS set. Defaults to a struck-through search icon, "No match" and
   * "Try adjusting or clearing the filters.".
   *
   * Only reachable when `filters` is set: with no filter form there is
   * nothing to be filtered by, so an empty page can only mean {@link
   * emptyState}.
   */
  noMatchState?: DataTableEmptyState;
  /**
   * Rich empty-state node rendered when the page is empty — e.g. an icon +
   * message + optional call-to-action. Replaces the whole thing, both states
   * included, so it outranks every prop above.
   *
   * ⚠️ **Only for a table with no {@link filters}.** Replacing both states
   * with one node makes the table structurally incapable of telling them
   * apart, whatever the node says: a filter that matched nothing renders the
   * "there is nothing here" message, with the filter that produced it still
   * sitting in the toolbar above. Lore's Apps page shipped exactly that and
   * offered to create the first app to a reader who had just searched for
   * one (feedback #P2160); its Releases page had the same defect, unreported
   * only because nobody had filtered it to zero.
   *
   * With `filters` set, reach for {@link emptyState} and {@link noMatchState}
   * instead. They take the same three pieces - `icon`, `title`,
   * `description` - plus an `action` slot for the button, and the table keeps
   * the choice between the two, which is the part a caller cannot get right
   * from the outside.
   *
   * Not type-enforced: the combination is a live one downstream, so the rule
   * is stated here rather than made uncompilable.
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
   * When true (default when `filters` is set), the table refetches on
   * every `form:change` event, debounced by 250ms. Set to `false` to
   * require an explicit submit.
   */
  autoApplyFilters?: boolean;
}
