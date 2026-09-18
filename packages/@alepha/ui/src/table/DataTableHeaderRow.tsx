import { useI18n } from "alepha/react/i18n";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  EyeOff,
} from "lucide-react";

import { Checkbox } from "../core/Checkbox.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../core/ContextMenu.tsx";
import { TableHead, TableRow } from "../core/Table.tsx";
import { cn } from "../core/utils.ts";
import type { ColumnDef, SortState } from "./dataTableTypes.ts";

export interface DataTableHeaderRowProps<T> {
  /**
   * The table's `cellPadding` classes for a header cell, merged before a
   * column's own `className`.
   */
  headClassName?: string;
  /**
   * The visible columns, in the reader's order.
   */
  visibleCols: Array<[string, ColumnDef<T>]>;
  hasCheckbox: boolean;
  hasRowActions: boolean;
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
  sort: SortState | null;
  toggleSort: (col: string, def: ColumnDef<T>) => void;
  setSortTo: (
    col: string,
    def: ColumnDef<T>,
    direction: "asc" | "desc" | null,
  ) => void;
  moveColumn: (key: string, delta: -1 | 1) => void;
  toggleColumn: (id: string) => void;
}

/**
 * The header row: the select-all checkbox, one header per visible column with
 * its sort control and context menu, and the cell above the row actions.
 */
export const DataTableHeaderRow = <T,>(props: DataTableHeaderRowProps<T>) => {
  const {
    visibleCols,
    hasCheckbox,
    hasRowActions,
    allSelected,
    someSelected,
    toggleAll,
    sort,
    toggleSort,
    setSortTo,
    moveColumn,
    toggleColumn,
  } = props;
  const { tr } = useI18n();

  return (
    <TableRow>
      {hasCheckbox && (
        <TableHead className={cn(props.headClassName, "w-10")}>
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            onCheckedChange={() => toggleAll()}
            aria-label={tr("dataTable.selectAll", {
              default: "Select all rows",
            })}
          />
        </TableHead>
      )}
      {visibleCols.map(([key, def], index) => {
        const sorted = def.sortable && sort?.field === (def.sortKey ?? key);
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
                  title={def.hint}
                  className={cn(
                    props.headClassName,
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
                  <span
                    className={cn(
                      def.hint &&
                        "decoration-muted-foreground/60 underline decoration-dotted underline-offset-4",
                    )}
                  >
                    {def.label}
                  </span>
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
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    def.hint &&
                      "decoration-muted-foreground/60 underline decoration-dotted underline-offset-4",
                  )}
                >
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
                  <ContextMenuItem onClick={() => setSortTo(key, def, "asc")}>
                    <ArrowUpAZ className="size-4" />
                    {tr("dataTable.sortAsc", {
                      default: "Sort ascending",
                    })}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setSortTo(key, def, "desc")}>
                    <ArrowDownAZ className="size-4" />
                    {tr("dataTable.sortDesc", {
                      default: "Sort descending",
                    })}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!sorted}
                    onClick={() => setSortTo(key, def, null)}
                  >
                    {tr("dataTable.sortClear", {
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
                {tr("dataTable.moveLeft", { default: "Move left" })}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={index === visibleCols.length - 1}
                onClick={() => moveColumn(key, 1)}
              >
                <ChevronRight className="size-4" />
                {tr("dataTable.moveRight", {
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
                {tr("dataTable.hideColumn", {
                  default: "Hide column",
                })}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {hasRowActions && (
        <TableHead className={cn(props.headClassName, "w-10")} />
      )}
    </TableRow>
  );
};
