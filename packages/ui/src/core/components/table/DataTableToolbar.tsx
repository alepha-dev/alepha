import { Badge, Divider, Flex } from "@mantine/core";
import { IconRefresh, IconX } from "@tabler/icons-react";
import type { TObject } from "alepha";
import { isValidElement, type ReactNode } from "react";
import { isComponentType } from "../../helpers/isComponentType.ts";
import ActionButton, { type ActionProps } from "../buttons/ActionButton.tsx";
import ColumnPicker from "./ColumnPicker.tsx";
import FilterPicker from "./FilterPicker.tsx";
import type {
  CheckboxAction,
  CheckboxActionContext,
  ColumnVisibility,
  DataTableColumn,
  FilterVisibility,
} from "./types.ts";

export interface DataTableToolbarProps<
  T extends object,
  Filters extends TObject,
> {
  columns: { [key: string]: DataTableColumn<T, Filters> };
  filters?: TObject;
  columnVisibility: ColumnVisibility;
  filterVisibility: FilterVisibility;
  onColumnVisibilityChange: (visibility: ColumnVisibility) => void;
  onFilterVisibilityChange: (visibility: FilterVisibility) => void;
  actions?: Array<ActionProps & { label?: ReactNode }>;
  onRefresh?: () => void;
  // Checkbox-related props
  selectedItems?: T[];
  checkboxActions?: Array<CheckboxAction<T>>;
  onClearSelection?: () => void;
}

const DataTableToolbar = <T extends object, Filters extends TObject>({
  columns,
  filters,
  columnVisibility,
  filterVisibility,
  onColumnVisibilityChange,
  onFilterVisibilityChange,
  actions,
  onRefresh,
  selectedItems = [],
  checkboxActions,
  onClearSelection,
}: DataTableToolbarProps<T, Filters>) => {
  const hasSelection = selectedItems.length > 0;

  const handleCheckboxAction = async (action: CheckboxAction<T>) => {
    const ctx: CheckboxActionContext<T> = {
      selectedItems,
      clearSelection: onClearSelection || (() => {}),
    };
    await action.onClick(ctx);
  };

  return (
    <Flex p="xs" style={{ borderBottom: "1px solid var(--alepha-border)" }}>
      <Flex gap={4} align="center">
        {filters && (
          <FilterPicker
            schema={filters}
            visibility={filterVisibility}
            onVisibilityChange={onFilterVisibilityChange}
          />
        )}
        <ColumnPicker
          columns={columns}
          visibility={columnVisibility}
          onVisibilityChange={onColumnVisibilityChange}
        />

        {hasSelection && (
          <>
            <Divider orientation="vertical" mx="xs" />
            <Badge variant="light" size="lg">
              {selectedItems.length} selected
            </Badge>
            <ActionButton
              variant="subtle"
              size="compact-sm"
              icon={IconX}
              onClick={onClearSelection}
            >
              Clear
            </ActionButton>
            {checkboxActions?.map((action, index) => (
              <ActionButton
                key={index}
                variant="light"
                size="compact-sm"
                intent={action.intent}
                icon={
                  action.icon && isComponentType(action.icon)
                    ? action.icon
                    : undefined
                }
                onClick={() => handleCheckboxAction(action)}
              >
                {action.label}
              </ActionButton>
            ))}
          </>
        )}
      </Flex>
      <Flex flex={1} />
      <Flex gap="xs">
        {actions?.map((props, index) =>
          !isValidElement(props) ? (
            <ActionButton key={index} {...(props as ActionProps)}>
              {(props as ActionProps & { label?: ReactNode }).label}
            </ActionButton>
          ) : (
            props
          ),
        )}
        <ActionButton icon={IconRefresh} onClick={onRefresh}>
          Refresh
        </ActionButton>
      </Flex>
    </Flex>
  );
};

export default DataTableToolbar;
