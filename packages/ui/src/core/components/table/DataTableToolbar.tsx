import { Badge, Divider, Flex } from "@mantine/core";
import {
  IconClipboard,
  IconDownload,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { TObject } from "alepha";
import { isValidElement, type ReactNode, useCallback } from "react";
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

// ─────────────────────────────────────────────────────────────────────────────

const escapeCsvField = (value: string): string => {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const extractText = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as any).props.children);
  }
  return "";
};

// ─────────────────────────────────────────────────────────────────────────────

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
  items: T[];
  withExport?: boolean;
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
  items,
  withExport,
  selectedItems = [],
  checkboxActions,
  onClearSelection,
}: DataTableToolbarProps<T, Filters>) => {
  const hasSelection = selectedItems.length > 0;

  const exportableColumns = useCallback(() => {
    return Object.entries(columns).filter(
      ([key, col]) => !col.actions && columnVisibility[key] !== false,
    );
  }, [columns, columnVisibility]);

  const buildRows = useCallback((): string[][] => {
    const cols = exportableColumns();
    return items.map((item) =>
      cols.map(([_key, col]) => {
        if (!col.value) return "";
        const node = col.value(item, {} as any);
        return extractText(node);
      }),
    );
  }, [items, exportableColumns]);

  const buildCsv = useCallback((): string => {
    const cols = exportableColumns();
    const header = cols.map(([_key, col]) => escapeCsvField(col.label));
    const rows = buildRows().map((row) => row.map(escapeCsvField));
    return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }, [exportableColumns, buildRows]);

  const exportCsv = useCallback(() => {
    const csv = buildCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [buildCsv]);

  const exportClipboard = useCallback(async () => {
    const cols = exportableColumns();
    const header = cols.map(([_key, col]) => col.label);
    const rows = buildRows();
    const text = [header.join("\t"), ...rows.map((r) => r.join("\t"))].join(
      "\n",
    );
    await navigator.clipboard.writeText(text);
  }, [exportableColumns, buildRows]);

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
        {withExport && (
          <ActionButton
            variant="subtle"
            icon={IconDownload}
            menu={{
              items: [
                {
                  label: "Export as CSV",
                  icon: <IconDownload size={14} />,
                  onClick: exportCsv,
                },
                {
                  label: "Copy to clipboard",
                  icon: <IconClipboard size={14} />,
                  onClick: exportClipboard,
                },
              ],
            }}
          />
        )}

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
        <ActionButton variant="subtle" icon={IconRefresh} onClick={onRefresh} />
      </Flex>
    </Flex>
  );
};

export default DataTableToolbar;
