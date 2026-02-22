import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export {
  type CheckboxAction,
  type CheckboxActionContext,
  type ColumnVisibility,
  DataTable,
  type DataTableColumn,
  type DataTableColumnContext,
  type DataTableProps,
  type DataTableSubmitContext,
  type FilterVisibility,
  type MaybePage,
} from "@alepha/ui";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | frontend | standard | beta |
 *
 * Data table component with filtering, sorting, and pagination.
 *
 * **Features:**
 * - DataTable with column sorting, filtering, pagination
 * - Checkbox selection with bulk actions
 * - Column visibility management
 * - CSV export
 * - Expandable panels and detail drawers
 *
 * @module alepha.ui.table
 */
export const AlephaUITable = $module({
  name: "alepha.ui.table",
});
