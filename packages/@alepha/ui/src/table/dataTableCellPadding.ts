/**
 * How much room a table's cells give their content.
 */
export type DataTableCellPadding = "small" | "normal" | "large";

/**
 * The classes each size puts on the cells: `cell` on every body cell and
 * skeleton cell, `head` on every header cell.
 *
 * `normal` restates the `Table` primitives' own `p-2` and `h-10 px-2`, so a
 * table that never sets the prop renders exactly as before. The classes are
 * merged BEFORE a column's own `className`, so a column that sets its own
 * padding keeps it at every size.
 */
export const DATA_TABLE_CELL_PADDING: Record<
  DataTableCellPadding,
  { cell: string; head: string }
> = {
  small: { cell: "px-2 py-1", head: "h-8 px-2" },
  normal: { cell: "p-2", head: "h-10 px-2" },
  large: { cell: "p-3", head: "h-11 px-3" },
};
