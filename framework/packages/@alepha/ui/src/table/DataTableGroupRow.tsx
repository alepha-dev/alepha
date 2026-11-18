import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { TableCell, TableRow } from "../core/Table.tsx";
import { cn } from "../core/utils.ts";

export interface DataTableGroupRowProps {
  /**
   * The group's key, on `data-group` for a test or a style to find it.
   */
  groupKey: string;
  label: ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Every column of the row, checkbox and actions included: the header
   * spans them all.
   */
  colSpan: number;
  cellClassName?: string;
}

/**
 * The header of one group of a grouped table (`groupBy`): a full-width row
 * with a chevron, the group's label and its row count, which folds the
 * rows under it. A `<button>` in the cell, so the fold is reachable by
 * keyboard and announced as expanded or collapsed.
 */
export const DataTableGroupRow = (props: DataTableGroupRowProps) => (
  <TableRow
    data-slot="data-table-group"
    data-group={props.groupKey}
    className="bg-muted/40 hover:bg-muted/60"
  >
    <TableCell
      colSpan={props.colSpan}
      className={cn(props.cellClassName, "py-0")}
    >
      <button
        type="button"
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
        className="focus-visible:ring-ring/50 flex h-9 w-full items-center gap-2 rounded-sm text-start text-sm font-medium outline-none focus-visible:ring-[3px]"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform rtl:-scale-x-100",
            !props.collapsed && "rotate-90 rtl:-rotate-90",
          )}
        />
        <span className="min-w-0 truncate">{props.label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {props.count}
        </span>
      </button>
    </TableCell>
  </TableRow>
);
