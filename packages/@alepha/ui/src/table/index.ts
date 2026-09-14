/**
 * Data tables.
 *
 * `AlephaTable` is a table wired for server-side pagination, sorting and
 * filtering, with row and bulk actions, persisted filters and a static mode for
 * local data (`paginateLocal`). Its filters are a record of fields
 * (`AlephaTableFilterFields`) that it draws on its own filter bar.
 * `AlephaTableFilterMenu`, `AlephaTableFilterDialog` and `AlephaTableBulkMenu`
 * are its parts, and `useTableSelection` its selection state. `PermissionMatrix` is the grid of
 * roles against permissions the admin and account kits draw.
 *
 * @module alepha.ui.table
 */

export { PAGE_SIZES } from "./AlephaTableFooter.tsx";
export { AlephaTable, type AlephaTableProps } from "./AlephaTable.tsx";
export type { AlephaTableBaseProps } from "./alephaTableBaseProps.ts";
export type {
  AlephaTableEmptyState,
  AlephaTableFilterField,
  AlephaTableFilterFieldOptions,
  AlephaTableFilterFields,
  AlephaTableFilterMode,
  AlephaTableFilterPreset,
  AlephaTableFilters,
  AlephaTableFilterValues,
  AlephaTableNoFilterFields,
  AlephaTablePersistedFacets,
  AlephaTableSource,
  BulkAction,
  BulkActionContext,
  BulkMenuAction,
  ColumnDef,
  RowAction,
  RowActionContext,
  RowActionEntry,
  RowActionGroup,
  TableAction,
  TableFetcher,
} from "./alephaTableTypes.ts";
export {
  AlephaTableBulkMenu,
  type AlephaTableBulkMenuProps,
} from "./AlephaTableBulkMenu.tsx";
export { alephaTableFilterKeys } from "./alephaTableFilterFields.ts";
export {
  AlephaTableFilterDialog,
  type AlephaTableFilterDialogProps,
} from "./AlephaTableFilterDialog.tsx";
export {
  AlephaTableFilterMenu,
  type AlephaTableFilterMenuProps,
} from "./AlephaTableFilterMenu.tsx";
export type {
  AlephaTableFilterOperatorOption,
  AlephaTableFilterOperatorPreset,
  AlephaTableFilterOperatorValue,
} from "./AlephaTableFilterOperator.tsx";
export { paginateLocal, type PaginateLocalOptions } from "./paginateLocal.ts";
export {
  PermissionMatrix,
  type PermissionMatrixColumn,
  type PermissionMatrixGroup,
  type PermissionMatrixProps,
  type PermissionMatrixRow,
} from "./PermissionMatrix.tsx";
export { type TableSelection, useTableSelection } from "./useTableSelection.ts";
