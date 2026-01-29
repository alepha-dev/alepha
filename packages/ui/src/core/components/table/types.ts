import type { TableProps, TableTrProps } from "@mantine/core";
import type {
  Alepha,
  Async,
  Page,
  PageMetadata,
  Static,
  TObject,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { FormModel } from "alepha/react/form";
import type { ReactNode } from "react";
import type { ActionProps } from "../buttons/ActionButton.tsx";
import type { TypeFormProps } from "../form/TypeForm.tsx";

// -----------------------------------------------------------------------------
// Visibility Types
// -----------------------------------------------------------------------------

export interface ColumnVisibility {
  [key: string]: boolean;
}

export interface FilterVisibility {
  [key: string]: boolean;
}

// -----------------------------------------------------------------------------
// Column Types
// -----------------------------------------------------------------------------

export interface DataTableColumnContext<Filters extends TObject> {
  index: number;
  form: FormModel<Filters>;
  alepha: Alepha;
}

export interface DataTableColumn<T extends object, Filters extends TObject> {
  label: string;
  value: (item: T, ctx: DataTableColumnContext<Filters>) => ReactNode;
  fit?: boolean;
  /**
   * Enable sorting for this column. When true, clicking the header will sort by this column.
   */
  sortable?: boolean;
  /**
   * The field name to use for sorting. If not provided, the column key is used.
   * Follows Alepha sort convention: 'field' for ASC, '-field' for DESC.
   */
  sortKey?: string;
}

// -----------------------------------------------------------------------------
// Page Types
// -----------------------------------------------------------------------------

export type MaybePage<T> = Omit<Page<T>, "page"> & {
  page?: Partial<PageMetadata>;
};

export interface DataTableSubmitContext<T extends object> {
  items: T[];
}

// -----------------------------------------------------------------------------
// Checkbox Types
// -----------------------------------------------------------------------------

export interface CheckboxActionContext<T extends object> {
  selectedItems: T[];
  clearSelection: () => void;
}

export interface CheckboxAction<T extends object> {
  label: ReactNode;
  icon?: ReactNode;
  intent?: "primary" | "success" | "danger" | "warning" | "info" | "none";
  onClick: (ctx: CheckboxActionContext<T>) => void | Promise<void>;
}

// -----------------------------------------------------------------------------
// Props Types
// -----------------------------------------------------------------------------

export interface DataTableProps<T extends object, Filters extends TObject> {
  /**
   * The items to display in the table. Can be a static page of items or a function that returns a promise resolving to a page of items.
   */
  items:
    | MaybePage<T>
    | ((
        filters: Static<Filters> & {
          page: number;
          size: number;
          sort?: string;
        },
        ctx: DataTableSubmitContext<T>,
      ) => Async<MaybePage<T>>);

  /**
   * The columns to display in the table. Each column is defined by a key and a DataTableColumn object.
   */
  columns: {
    [key: string]: DataTableColumn<T, Filters>;
  };

  defaultSize?: number;

  typeFormProps?: Partial<Omit<TypeFormProps<Filters>, "form">>;

  onFilterChange?: (
    key: string,
    value: unknown,
    form: FormModel<Filters>,
  ) => void;

  /**
   * Optional filters to apply to the data.
   */
  filters?: TObject;

  panel?: (item: T) => ReactNode;
  canPanel?: (item: T) => boolean;

  submitOnInit?: boolean;
  submitEvery?: DurationLike;

  withLineNumbers?: boolean;

  /**
   * Enable row selection with checkboxes. When true, a checkbox column is added as the first column.
   */
  withCheckbox?: boolean;

  /**
   * Function to get a unique key for each item. Required when withCheckbox is true.
   * Used to track selected items across pagination.
   */
  getItemKey?: (item: T) => string;

  /**
   * Actions to display when items are selected. Each action receives the selected items.
   */
  checkboxActions?: Array<CheckboxAction<T>>;

  actions?: Array<ActionProps & { label?: ReactNode }>;

  /**
   * Enable infinity scroll mode. When true, pagination controls are hidden and new items are loaded automatically when scrolling to the bottom.
   */
  infinityScroll?: boolean;

  // -------------------------------------------------------------------------------------------------------------------
  // Column Visibility
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Initial column visibility state. By default, first 10 columns are visible.
   */
  defaultColumnVisibility?: ColumnVisibility;

  /**
   * Maximum number of columns to show by default. Default is 10.
   */
  defaultVisibleColumnCount?: number;

  /**
   * Callback when column visibility changes.
   */
  onColumnVisibilityChange?: (visibility: ColumnVisibility) => void;

  // -------------------------------------------------------------------------------------------------------------------
  // Filter Visibility
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Initial filter visibility state. By default, all filters are visible.
   */
  defaultFilterVisibility?: FilterVisibility;

  /**
   * Callback when filter visibility changes.
   */
  onFilterVisibilityChange?: (visibility: FilterVisibility) => void;

  // -------------------------------------------------------------------------------------------------------------------
  // Mantine Props
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Props to pass to the Mantine Table component.
   */
  tableProps?: TableProps;

  /**
   * Function to generate props for each table row based on the item.
   */
  tableTrProps?: (item: T) => TableTrProps;
}
