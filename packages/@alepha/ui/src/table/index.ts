/**
 * Data tables.
 *
 * `DataTable` is a table wired for server-side pagination, sorting and
 * filtering, with row and bulk actions, persisted filters and a static mode for
 * local data (`paginateLocal`). Its filters are a record of fields
 * (`DataTableFilterFields`) that it draws on its own filter bar. Above that
 * bar it can hold a collapsible summary (`DataTableSummary`): stat cards
 * (`DataTableStatCard`) given or fetched with the table's filters, and any
 * node beside them. A `help` node sits behind a `?` at the end of the
 * toolbar's icons.
 * `DataTableFilterMenu`, `DataTableFilterDialog` and `DataTableBulkMenu`
 * are its parts, and `useTableSelection` its selection state. `PermissionMatrix` is the grid of
 * roles against permissions the admin and account kits draw.
 *
 * @module alepha.ui.table
 */

export { PAGE_SIZES } from "./DataTableFooter.tsx";
export { DataTable, type DataTableProps } from "./DataTable.tsx";
export type { DataTableBaseProps } from "./dataTableBaseProps.ts";
export type {
  DataTableEmptyState,
  DataTableFilterField,
  DataTableFilterFieldOptions,
  DataTableFilterFields,
  DataTableFilterMode,
  DataTableFilterPreset,
  DataTableFilters,
  DataTableFilterValues,
  DataTableNoFilterFields,
  DataTablePersistedFacets,
  DataTableSource,
  DataTableStatCard,
  DataTableSummary,
  DataTableSummaryContext,
  DataTableSummaryFetcher,
  BulkAction,
  BulkActionContext,
  BulkMenuAction,
  ColumnDef,
  DataTableCellContext,
  RowAction,
  RowActionContext,
  RowActionEntry,
  RowActionGroup,
  TableAction,
  TableFetcher,
} from "./dataTableTypes.ts";
export {
  DataTableBulkMenu,
  type DataTableBulkMenuProps,
} from "./DataTableBulkMenu.tsx";
export { dataTableFilterKeys } from "./dataTableFilterFields.ts";
export {
  DataTableFilterDialog,
  type DataTableFilterDialogProps,
} from "./DataTableFilterDialog.tsx";
export {
  DataTableFilterMenu,
  type DataTableFilterMenuProps,
} from "./DataTableFilterMenu.tsx";
export type {
  DataTableFilterOperatorOption,
  DataTableFilterOperatorPreset,
  DataTableFilterOperatorValue,
} from "./DataTableFilterOperator.tsx";
export type { DataTableCellPadding } from "./dataTableCellPadding.ts";
export type { DataTableSquareRight } from "./dataTableSquareRight.ts";
export { paginateLocal, type PaginateLocalOptions } from "./paginateLocal.ts";
export {
  PermissionMatrix,
  type PermissionMatrixColumn,
  type PermissionMatrixGroup,
  type PermissionMatrixProps,
  type PermissionMatrixRow,
} from "./PermissionMatrix.tsx";
export { type TableSelection, useTableSelection } from "./useTableSelection.ts";
