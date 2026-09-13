import { useI18n } from "alepha/react/i18n";
import { Inbox, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { Checkbox } from "../core/Checkbox.tsx";
import { TableBody, TableCell, TableRow } from "../core/Table.tsx";
import { cn } from "../core/utils.ts";
import { AlephaTableRowActionsMenu } from "./AlephaTableRowActionsMenu.tsx";
import { AlephaTableSkeletonRows } from "./AlephaTableSkeletonRows.tsx";
import type {
  AlephaTableEmptyState,
  ColumnDef,
  RowActionContext,
  RowActionEntry,
} from "./alephaTableTypes.ts";

export interface AlephaTableBodyProps<T> {
  data: T[];
  /**
   * One key per row of `data`, index for index.
   */
  rowKeys: string[];
  loading: boolean;
  /**
   * The visible columns, in the reader's order.
   */
  visibleCols: Array<[string, ColumnDef<T>]>;
  hasCheckbox: boolean;
  hasRowActions: boolean;
  /**
   * Whether a filter is set, which picks the no-match empty state over the
   * no-items one.
   */
  hasActiveFilters: boolean;
  selection: ReadonlyMap<string, T>;
  toggleRow: (item: T) => void;
  rowCtx: RowActionContext;
  rowActions?: (item: T) => RowActionEntry<T>[];
  onRowClick?: (item: T) => void;
  empty?: ReactNode;
  emptyMessage?: string;
  emptyState?: AlephaTableEmptyState;
  noMatchState?: AlephaTableEmptyState;
}

/**
 * The table body: skeleton rows while the first page loads, the empty state
 * when the page came back empty, the rows otherwise.
 */
export const AlephaTableBody = <T,>(props: AlephaTableBodyProps<T>) => {
  const {
    data,
    rowKeys,
    loading,
    visibleCols,
    hasCheckbox,
    hasRowActions,
    hasActiveFilters,
    selection,
    toggleRow,
    rowCtx,
  } = props;
  const { tr } = useI18n();

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
  const emptyAction = emptyOverride.action;
  // Suppressed by a bare `emptyMessage`: that prop is the whole message, and
  // pairing someone's "No artifacts yet" with a stock second line reads as a
  // component talking over its caller.
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

  return (
    <TableBody>
      {loading && data.length === 0 ? (
        <AlephaTableSkeletonRows
          rows={5}
          cols={
            visibleCols.length + (hasCheckbox ? 1 : 0) + (hasRowActions ? 1 : 0)
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
                {emptyAction ? <div className="pt-2">{emptyAction}</div> : null}
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
                  <AlephaTableRowActionsMenu
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
  );
};
