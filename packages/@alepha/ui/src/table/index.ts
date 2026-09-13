/**
 * Data tables.
 *
 * `AlephaTable` is a table wired for server-side pagination, sorting and
 * filtering, with row and bulk actions, persisted filters and a static mode for
 * local data (`paginateLocal`). `AlephaTableFilterBar`, `AlephaTableFilterMenu`,
 * `AlephaTableFilterDialog` and `AlephaTableBulkMenu` are its parts, and
 * `useTableSelection` its selection state. `PermissionMatrix` is the grid of
 * roles against permissions the admin and account kits draw.
 *
 * @module alepha.ui.table
 */

export {
  AlephaTable,
  type AlephaTableBaseProps,
  type AlephaTableEmptyState,
  type AlephaTableFilters,
  type AlephaTablePersistedFacets,
  type AlephaTableProps,
  type AlephaTableSource,
  type BulkAction,
  type BulkActionContext,
  type BulkMenuAction,
  type ColumnDef,
  PAGE_SIZES,
  type RowAction,
  type RowActionContext,
  type RowActionEntry,
  type RowActionGroup,
  type TableAction,
  type TableFetcher,
} from "./AlephaTable.tsx";
export {
  AlephaTableBulkMenu,
  type AlephaTableBulkMenuProps,
} from "./AlephaTableBulkMenu.tsx";
export {
  AlephaTableFilterBar,
  type AlephaTableFilterBarProps,
  type AlephaTableFilterBarSearch,
  type AlephaTableFilterField,
} from "./AlephaTableFilterBar.tsx";
export {
  AlephaTableFilterDialog,
  type AlephaTableFilterDialogProps,
} from "./AlephaTableFilterDialog.tsx";
export {
  AlephaTableFilterMenu,
  type AlephaTableFilterMenuProps,
} from "./AlephaTableFilterMenu.tsx";
export { paginateLocal, type PaginateLocalOptions } from "./paginateLocal.ts";
export {
  PermissionMatrix,
  type PermissionMatrixColumn,
  type PermissionMatrixGroup,
  type PermissionMatrixProps,
  type PermissionMatrixRow,
} from "./PermissionMatrix.tsx";
export { type TableSelection, useTableSelection } from "./useTableSelection.ts";
