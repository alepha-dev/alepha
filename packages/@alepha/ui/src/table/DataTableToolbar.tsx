import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { FunnelX, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../core/Button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";
import { DataTableColumnPicker } from "./DataTableColumnPicker.tsx";
import { DataTableFilterBar } from "./DataTableFilterBar.tsx";
import { DataTableFilterDialog } from "./DataTableFilterDialog.tsx";
import { dataTableFilterBarFields } from "./dataTableFilterFields.ts";
import { DataTableFilterMenu } from "./DataTableFilterMenu.tsx";
import type {
  DataTableFilterFields,
  DataTableFilters,
  ColumnDef,
  TableAction,
} from "./dataTableTypes.ts";
import type { DataTableFilterDefinition } from "./useDataTableFilterForm.ts";

export interface DataTableToolbarProps<T> {
  columns: Record<string, ColumnDef<T>>;
  filters?: DataTableFilters<DataTableFilterFields>;
  /**
   * The table's own filter form.
   */
  form?: FormModel<ZObject>;
  /**
   * What the filters are, as read at mount. The bar is drawn from it and from
   * `filters.fields`, read every render.
   */
  filterDefinition?: DataTableFilterDefinition;
  /**
   * Which filters are on the bar. The table's state; see
   * `useDataTableFilterVisibility`.
   */
  shownFilters: readonly string[];
  onShownFiltersChange: (shown: string[], act: boolean) => void;
  /**
   * Whether Reset filters would change anything: a value set, or a bar that
   * differs from its declaration.
   */
  canResetFilters: boolean;
  toolbar?: ReactNode;
  actions?: TableAction[];
  isMobile: boolean;
  showColumnPicker: boolean;
  showActionsMenu: boolean;
  activeFilterCount: number;
  /**
   * Whether the table reads its filters back from the query, which is what
   * makes a shared link worth copying.
   */
  canShare: boolean;
  resetFilters: () => void;
  shareFilters: () => Promise<void>;
  /**
   * Every column key, in the reader's order.
   */
  orderedKeys: string[];
  visibleColumns: Set<string>;
  toggleColumn: (id: string) => void;
  reorderColumn: (key: string, target: string) => void;
  isRefreshing: boolean;
  handleRefreshClick: () => void;
  /**
   * The table's `chromeClassName`, merged after the bar's own classes.
   */
  className?: string;
}

/**
 * The bar above the rows: the filter form (or its dialog on a phone), the
 * caller's `toolbar` slot and `actions`, then the column picker, the filter
 * menu and refresh.
 */
export const DataTableToolbar = <T,>(props: DataTableToolbarProps<T>) => {
  const {
    form,
    isMobile,
    showColumnPicker,
    showActionsMenu,
    activeFilterCount,
    canShare,
    resetFilters,
    shareFilters,
    orderedKeys,
    visibleColumns,
    toggleColumn,
    reorderColumn,
    isRefreshing,
    handleRefreshClick,
  } = props;
  const { tr } = useI18n();

  /**
   * The filter controls, in either place. With `render`, the caller draws
   * them and the bar is not mounted; without it, the table draws the bar from
   * `fields`.
   */
  const filterControls = (variant: "bar" | "dialog") => {
    if (!props.filters || !form) return null;
    if (props.filters.render) return props.filters.render(form);
    if (!props.filterDefinition) return null;
    return (
      <DataTableFilterBar
        form={form}
        fields={dataTableFilterBarFields(
          props.filters.fields,
          props.filterDefinition,
        )}
        shown={props.shownFilters}
        onShownChange={props.onShownFiltersChange}
        variant={variant}
      />
    );
  };

  return (
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
    // primitives, whose transparent light fill is right everywhere
    // else.
    //
    // `bg-background` suits both modes: white against the muted bar in
    // light, near-black in dark, so the control reads as a well sunk
    // into the chrome either way. The `dark:` copy is not redundant —
    // the primitives ship `dark:bg-input/30` at (0,2,0), a translucent
    // WHITE wash that leaves the field lighter than the bar. Only the
    // dark-scoped rule (0,3,0) outranks it, and without it the two
    // controls disagreed: the trigger went dark, the input stayed light.
    //
    // ⚠️ **`date-trigger` is named, and it is not a third spelling of
    // the same thing.** `:is(input,[role=combobox])` describes the two
    // shapes a field happened to have when this was written, and a
    // calendar is neither: `ControlDate` and `ControlDateRange` open a
    // POPOVER, so their trigger is a plain button with no combobox role
    // to match on. It therefore kept the primitives' own
    // `dark:bg-input/30` and sat LIGHTER than the bar while every select
    // beside it sat darker - measured on Admin > Audit log, `oklab(1 0 0
    // / 0.045)` against the selects' opaque `oklch(0.145 0 0)`. Light
    // mode had it the other way round, the calendar taking the muted
    // grey. That is what #Q2295 reported, and what #Q2282 and #Q2283
    // could not reach: they made the date controls draw the kit's
    // trigger, and this bar was still addressing fields by tag and role
    // rather than by what they are.
    //
    // The canonical list of field surfaces is the hover-border rule in
    // `styles.css`, which enumerates the same slots. Add a field shape
    // there and it belongs here too.
    //
    // The `--bevel` line, laid just inside the bar's own top border,
    // the same fold the header and the footer carry. This one is the
    // top edge of the whole table block, so it is the one that decides
    // whether the block sits ON the page or IN it.
    <div
      className={cn(
        "bg-muted [&_:is(input,[role=combobox],[data-slot=date-trigger])]:bg-background dark:[&_:is(input,[role=combobox],[data-slot=date-trigger])]:bg-background flex flex-wrap items-end gap-2 rounded-md rounded-b-none border p-2 shadow-[inset_0_1px_0_0_var(--bevel)]",
        props.className,
      )}
    >
      {props.filters && form && !isMobile ? (
        <form {...form.props} className="flex flex-1 flex-wrap items-end gap-2">
          {filterControls("bar")}
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
      {props.toolbar && <div className="self-center">{props.toolbar}</div>}
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
                      <span className="hidden sm:inline">{action.label}</span>
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
            <DataTableFilterDialog
              form={form}
              activeCount={activeFilterCount}
              canReset={props.canResetFilters}
              onReset={resetFilters}
              onShare={canShare ? shareFilters : undefined}
            >
              {filterControls("dialog")}
            </DataTableFilterDialog>
          )}
          {showColumnPicker && (
            <DataTableColumnPicker<T>
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
            <DataTableFilterMenu
              activeCount={activeFilterCount}
              canReset={props.canResetFilters}
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
                    aria-label={tr("dataTable.resetFilters", {
                      default: "Reset filters",
                    })}
                    disabled={!props.canResetFilters}
                    onClick={resetFilters}
                  />
                }
              >
                <FunnelX className="size-4" />
              </TooltipTrigger>
              <TooltipContent>
                {tr("dataTable.resetFilters", {
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
                    aria-label={tr("dataTable.refresh", {
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
                {tr("dataTable.refresh", { default: "Refresh" })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
};
