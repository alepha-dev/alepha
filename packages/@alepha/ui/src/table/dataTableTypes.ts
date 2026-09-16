import type {
  Infer,
  Page,
  ZObject,
  ZodOptional,
  ZodString,
  ZType,
} from "alepha";
import type { FormModel } from "alepha/react/form";
import type { ComponentType, ReactNode, SVGProps } from "react";

import type { ControlProps } from "../form/Control.tsx";
import type { SelectOption } from "../form/ControlSelect.tsx";
import type {
  DataTableFilterOperatorOption,
  DataTableFilterOperatorPreset,
  DataTableFilterOperatorValue,
} from "./DataTableFilterOperator.tsx";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface ColumnDef<T> {
  label: string;
  /**
   * A sentence explaining what the column holds, shown as the header's
   * tooltip, for a column whose label alone would be misread: a count that
   * only counts what is kept, a date in a zone that is not the reader's.
   */
  hint?: string;
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
 *
 * `clearSelection()` empties the checkbox set, as it does for a bulk action.
 * A row deleted from its own menu may be ticked, and a selection that
 * survives the delete points at a row that no longer exists.
 */
export interface RowActionContext {
  refresh: () => void;
  clearSelection: () => void;
}

export interface RowAction<T> {
  label: string;
  icon?: IconType;
  onClick: (item: T, ctx: RowActionContext) => void | Promise<void>;
  destructive?: boolean;
  disabled?: (item: T) => boolean;
  /**
   * Whether this entry is the row's current value, for a group that picks
   * one of several - which release the row ships in, which area it sits in.
   * Declaring it renders the entry as a checkbox item, so the check mark and
   * the `aria-checked` both come from the primitive rather than from a
   * marker glued into the label.
   *
   * ⚠️ Omitting it is not the same as returning false. An entry with no
   * `checked` stays an ordinary `menuitem`; one that returns false is a
   * `menuitemcheckbox` that happens to be unchecked, which is what a query
   * by role has to account for.
   *
   * `destructive` is ignored on a checked entry: nothing that picks a value
   * out of a list is also a delete.
   */
  checked?: (item: T) => boolean;
}

/**
 * A row action that is a submenu: a label, an icon, and the actions it
 * holds. One level only: a group's children are actions, never groups.
 *
 * The discriminant is the presence of `children`, so every caller that
 * returns a plain `RowAction[]` keeps compiling unchanged.
 *
 * ⚠️ A group with no children renders nothing, and does not count towards
 * the row menu existing at all: a row whose only entry is an empty group
 * gets no three-dots trigger. That lets a caller build `children`
 * conditionally without checking whether anything survived.
 */
export interface RowActionGroup<T> {
  label: string;
  icon?: IconType;
  children: RowAction<T>[];
}

export type RowActionEntry<T> = RowAction<T> | RowActionGroup<T>;

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
 * <DataTable<Quest> bulkActions={[shelve, addToRelease]} />
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
export interface DataTableEmptyState {
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
   * Most useful on {@link DataTableBaseProps.emptyState}, where "there is
   * nothing here" has an obvious answer - create the first one. The no-match
   * side takes it too, for a "Clear filters" button.
   */
  action?: ReactNode;
}

/**
 * Which of the preferences {@link DataTableBaseProps.persistenceKey} stores
 * are actually stored.
 *
 * Every facet defaults to ON, so a table that sets a key and nothing else
 * behaves exactly as it always has. Only name the ones you want OFF.
 *
 * The facets are genuinely different kinds of preference, which is why one
 * switch over all three was the wrong shape. Column layout and sort are what
 * a reader arranged and expects to find again; a filter is what they were
 * looking for last time, and restoring it opens the page narrowed by a
 * question they have already answered - the hazard
 * {@link DataTableFilters.seedValues} names as "landing on last week's
 * stored filter".
 *
 * ⚠️ The footer's page SIZE is not one of these and is always stored with the
 * key. It is a fourth thing, nothing has asked to separate it, and leaving it
 * alone is what keeps this addition invisible to every existing caller.
 *
 * ⚠️ Read where `persistenceKey` is, so treat it as static per call site.
 * Turning a facet off does not delete what it previously wrote: the stored
 * value is simply never read again, because writing on mount is the bug the
 * column and filter effects exist to avoid.
 */
export interface DataTablePersistedFacets {
  /**
   * The filter form's values, and which filters are on the bar. Off means the
   * table opens unfiltered, on the bar its fields declare, every time,
   * whatever the reader last typed or added.
   */
  filters?: boolean;
  /**
   * Which columns are visible, and in what order.
   */
  columns?: boolean;
  /**
   * The sorted column and its direction.
   */
  sort?: boolean;
}

/**
 * How a filter reaches the bar.
 *
 * - `"optional"`, the default: off the bar until the reader adds it, or until
 *   it holds a value.
 * - `"default"`: on the bar from the start, empty, and removable like any
 *   other. It carries no value; that is `initialValues`.
 * - `"locked"`: always on the bar and never removable. In the Alepha
 *   ecosystem only the search box is locked, through `preset: "search"`.
 *
 * Read once, at mount.
 */
export type DataTableFilterMode = "optional" | "default" | "locked";

/**
 * A ready-made filter. `"search"` is a locked text box with the kit's
 * translated "Search" placeholder and the `Search` icon; its schema is
 * `z.string()`. Any property written beside it wins.
 */
export type DataTableFilterPreset = "search";

/**
 * What every filter field may say about itself, whether it carries a schema
 * or a preset.
 */
export interface DataTableFilterFieldOptions {
  /**
   * What the filter is called: the add menu's item, the muted name on a set
   * trigger, and the accessible name of its control. Read every render.
   */
  label?: string;
  /**
   * A sentence about what the filter matches. Read every render.
   */
  description?: string;
  /**
   * Shown while the filter is empty. Read every render.
   */
  placeholder?: string;
  /**
   * Read every render.
   */
  icon?: IconType;
  /**
   * The options of a list filter, for live data (an atom, a fetch). Without
   * it, an enum schema gives the options. Read every render.
   */
  items?: SelectOption[];
  /**
   * The label of one option an enum schema gives. Its argument is `any` in
   * the hoisted form; annotate it where a label map needs the literal type.
   * Read every render.
   */
  optionLabel?: (value: any) => string;
  /**
   * How the value may be compared: a preset labelled by the kit, or a list of
   * your own with the default FIRST. The table adds `<key>Op` to its schema,
   * to `fromQuery`, persistence and the Share link, and to the type `fetch`
   * reads. A list's values type as `string` unless it is written `as const`.
   */
  operators?:
    | DataTableFilterOperatorPreset
    | readonly DataTableFilterOperatorOption[];
  /**
   * The key the operator is stored and sent under. Defaults to `<key>Op`. It
   * types as a key of the filters only when written as a literal
   * (`"tagOperator" as const`).
   */
  operatorKey?: string;
  /**
   * The filter has nothing to offer yet (a project with no areas). Set this
   * rather than dropping the key: the key set is read once, at mount. Read
   * every render.
   */
  hidden?: boolean;
  /**
   * See {@link DataTableFilterMode}. `"optional"` when absent.
   */
  mode?: DataTableFilterMode;
  /**
   * Anything else `Control` takes: `clearLabel`, `countLabel`, `searchable`,
   * `inputProps`.
   */
  control?: Omit<ControlProps, "input" | "label">;
}

/**
 * One filter of a `DataTable`: its schema, and how the bar draws it.
 *
 * A field carries a `schema`, a `preset`, or both. The table wraps the schema
 * in `.optional()` itself, since every filter is optional by nature.
 */
export type DataTableFilterField =
  | (DataTableFilterFieldOptions & {
      schema: ZType;
      preset?: DataTableFilterPreset;
    })
  | (DataTableFilterFieldOptions & {
      schema?: ZType;
      preset: DataTableFilterPreset;
    });

/**
 * A table's filters, keyed by the name each one is sent under. Declared as a
 * `const` in the component body, so `tr()` and atoms work, and passed with its
 * type:
 *
 * ```tsx
 * const filterFields = {
 *   search: { preset: "search" },
 *   status: {
 *     schema: z.array(questStatusSchema),
 *     label: "Status",
 *     operators: "is",
 *   },
 * } satisfies DataTableFilterFields;
 *
 * <DataTable<Quest, typeof filterFields>
 *   filters={{ fields: filterFields }}
 *   fetch={({ filters }) => api.list({ query: filters })}
 * />
 * ```
 */
export type DataTableFilterFields = Record<string, DataTableFilterField>;

/**
 * The default for a table's filter fields: none.
 *
 * A record of `never` rather than a permissive one, so an inline `fields`
 * under a bare `<DataTable<Row>>` is a compile error instead of a fetcher
 * whose filters silently type as `any`. TypeScript has no partial inference
 * of type arguments: with the row type written, the fields type is the
 * default, never what was passed.
 */
export type DataTableNoFilterFields = { [key: string]: never };

/**
 * The operator key a field adds, or `never` for a field without operators.
 */
export type DataTableFilterOperatorKey<
  K extends string,
  Field,
> = Field extends { operators: any }
  ? Field extends { operatorKey: infer OK extends string }
    ? string extends OK
      ? never
      : OK
    : `${K}Op`
  : never;

/**
 * The values a field's operator key accepts.
 */
export type DataTableFilterOperatorValues<Field> = Field extends {
  operators: infer O;
}
  ? O extends DataTableFilterOperatorPreset
    ? DataTableFilterOperatorValue<O>
    : O extends readonly { value: infer V }[]
      ? V
      : never
  : never;

/**
 * The schema a field is read with: its own, or `z.string()` for a preset.
 */
export type DataTableFilterFieldSchema<Field> = Field extends {
  schema: infer S extends ZType;
}
  ? S
  : ZodString;

/**
 * The filter values of a table, as `fetch`, the `data` predicate,
 * `initialValues` and `seedValues` read them: one optional key per field, and
 * one per operator key. Untyped fields read as `Record<string, any>`.
 */
export type DataTableFilterValues<F> = string extends keyof F
  ? Record<string, any>
  : {
      [K in keyof F & string]?: Infer<DataTableFilterFieldSchema<F[K]>>;
    } & {
      [
        K in keyof F & string as DataTableFilterOperatorKey<K, F[K]>
      ]?: DataTableFilterOperatorValues<F[K]>;
    };

/**
 * The `z.object` the table builds from its fields, as a type: what `render`'s
 * form is typed with.
 */
export type DataTableFilterSchema<F> = string extends keyof F
  ? ZObject
  : ZObject<
      {
        [K in keyof F & string]: ZodOptional<DataTableFilterFieldSchema<F[K]>>;
      } & {
        [
          K in keyof F & string as DataTableFilterOperatorKey<K, F[K]>
        ]: ZodOptional<ZodString>;
      }
    >;

/**
 * A table's filters: the fields, and how they are seeded.
 *
 * The table builds its filter form from the fields, draws them on its filter
 * bar (in the toolbar, and in a dialog on a phone), persists the values under
 * `persistenceKey` when set, and refetches on every change, debounced.
 *
 * Declare the fields as a `const` in the component body, so `tr()` and atoms
 * work, and pass its type beside the row's: that is what types `fetch`'s
 * filters, the `data` predicate, `initialValues`, `seedValues` and
 * `fromQuery`.
 *
 * ```tsx
 * const filterFields = {
 *   search: { preset: "search" },
 *   status: {
 *     schema: z.array(questStatusSchema),
 *     label: "Status",
 *     icon: CircleDot,
 *     operators: "is", // the table adds `statusOp`
 *     optionLabel: (status: QuestStatus) => statusLabel(status),
 *   },
 *   area: {
 *     schema: z.array(z.string()),
 *     label: "Area",
 *     items: areaItems, // live, from an atom
 *     hidden: areaItems.length === 0,
 *   },
 * } satisfies DataTableFilterFields;
 *
 * <DataTable<Quest, typeof filterFields>
 *   filters={{ fields: filterFields, fromQuery: true }}
 *   fetch={({ filters }) => api.list({ query: filters })}
 * />
 * ```
 *
 * **Where a filter starts is its `mode`.** `"optional"`, the default, is off
 * the bar until the reader adds it from the funnel-plus menu. `"default"` is
 * on the bar from the start, empty, and removable. `"locked"` is always on the
 * bar and never removable; in the Alepha ecosystem only the search box is,
 * through `preset: "search"`. A filter holding a value is on the bar whatever
 * its mode, and so is a `hidden` one.
 *
 * **Which filters are on the bar is remembered** under `persistenceKey`,
 * behind the `filters` facet, as the optional filters the reader added and
 * the default ones they removed. Reset filters empties every value and returns
 * the bar to the modes.
 */
export interface DataTableFilters<
  F extends DataTableFilterFields = DataTableNoFilterFields,
> {
  /**
   * The filters, as a record of fields each carrying its own schema. See
   * {@link DataTableFilterFields}.
   *
   * The key set, each schema, each preset and each mode are read ONCE, at
   * mount: persistence, `fromQuery` and the form all anchor there. Every other
   * property is read on every render. A key set that changes after mount is
   * warned about in development, because the change would otherwise do
   * nothing.
   */
  fields: F;
  initialValues?: Partial<DataTableFilterValues<F>>;
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
  seedValues?: Partial<DataTableFilterValues<F>>;
  /**
   * Fill the filters from the URL query on arrival.
   *
   * `true` reads every param whose name matches a filter key, operator keys
   * included (`?status=done&statusOp=not`); an array narrows that to the keys
   * it names, and a field named there brings its operator key along, since a
   * link read without its operator means the opposite of what it said. Params
   * the filters do not declare are ignored, so the page keeps owning its own
   * (`?tab=`, a locale, a tracking param). Multi-value filters are
   * comma-joined: `?status=new,triaged`.
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
  fromQuery?: boolean | readonly (keyof DataTableFilterValues<F> & string)[];
  /**
   * Draw the filter controls yourself, from the table's form typed from
   * `fields`, instead of the table's filter bar. The escape hatch, for a
   * control the bar cannot draw.
   *
   * With `render`, only each field's `schema` and `preset` are read; the
   * properties that describe the bar (`label`, `icon`, `items`, `mode` and the
   * rest) are ignored.
   */
  render?: (form: FormModel<DataTableFilterSchema<F>>) => ReactNode;
}

export interface SortState {
  field: string;
  direction: "asc" | "desc";
}

export type TableFetcher<
  T,
  F extends DataTableFilterFields = DataTableNoFilterFields,
> = (params: {
  page: number;
  size: number;
  sort?: string;
  filters?: DataTableFilterValues<F>;
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
export type DataTableSource<
  T,
  F extends DataTableFilterFields = DataTableNoFilterFields,
> =
  | {
      /**
       * Fetcher invoked with paging + sort + filters. Should return an
       * Alepha `Page<T>`.
       */
      fetch: TableFetcher<T, F>;
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
      filter?: (item: T, filters: DataTableFilterValues<F>) => boolean;
      fetch?: never;
    };
