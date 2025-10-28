import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Checkbox,
  Flex,
  Group,
  Loader,
  Menu,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Table,
  type TableProps,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconColumns,
  IconDownload,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

// Types
export type SortDirection = "asc" | "desc" | null;

export interface DataTableColumn<T = any> {
  accessor: keyof T | string;
  title?: string;
  width?: number | string;
  sortable?: boolean;
  filterable?: boolean;
  hidden?: boolean;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  renderHeader?: () => React.ReactNode;
  align?: "left" | "center" | "right";
  ellipsis?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableSort {
  column: string;
  direction: SortDirection;
}

export interface DataTableFilter {
  column: string;
  value: string;
  operator?: "contains" | "equals" | "startsWith" | "endsWith";
}

export interface DataTableProps<T = any> extends Omit<TableProps, "data"> {
  // Data
  data: T[];
  columns: DataTableColumn<T>[];
  loading?: boolean;
  emptyMessage?: string;

  // Selection
  selectable?: boolean;
  selectedRows?: T[];
  onRowSelect?: (rows: T[]) => void;

  // Sorting
  sortable?: boolean;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;

  // Filtering
  filterable?: boolean;
  filters?: DataTableFilter[];
  onFiltersChange?: (filters: DataTableFilter[]) => void;
  filterPlaceholder?: string;

  // Pagination
  paginate?: boolean;
  page?: number;
  pageSize?: number;
  totalRecords?: number;
  pageSizeOptions?: number[];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;

  // Row actions
  rowActions?: (record: T, index: number) => React.ReactNode;
  onRowClick?: (record: T, index: number) => void;
  rowClassName?: (record: T, index: number) => string;

  // Features
  showHeader?: boolean;
  showFooter?: boolean;
  stickyHeader?: boolean;
  striped?: boolean;
  highlightOnHover?: boolean;

  // Toolbar
  showToolbar?: boolean;
  title?: string;
  actions?: React.ReactNode;
  showColumnToggle?: boolean;
  showRefresh?: boolean;
  onRefresh?: () => void;
  showExport?: boolean;
  onExport?: () => void;

  // Layout
  height?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
}

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

export default function DataTable<T = any>({
  data = [],
  columns: initialColumns = [],
  loading = false,
  emptyMessage = "No data available",

  selectable = false,
  selectedRows = [],
  onRowSelect,

  sortable = false,
  sort,
  onSortChange,

  filterable = false,
  filters = [],
  onFiltersChange,
  filterPlaceholder = "Search...",

  paginate = false,
  page = 1,
  pageSize = 10,
  totalRecords,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,

  rowActions,
  onRowClick,
  rowClassName,

  showHeader = true,
  showFooter = true,
  stickyHeader = false,
  striped = false,
  highlightOnHover = true,

  showToolbar = true,
  title,
  actions,
  showColumnToggle = true,
  showRefresh = false,
  onRefresh,
  showExport = false,
  onExport,

  height,
  minHeight,
  maxHeight,

  ...tableProps
}: DataTableProps<T>) {
  // State management - use controlled/uncontrolled pattern
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [globalFilter, setGlobalFilter] = useState("");

  // Use props directly if provided, otherwise use internal state
  const [internalPage, setInternalPage] = useState(page);
  const [internalPageSize, setInternalPageSize] = useState(pageSize);
  const [internalSort, setInternalSort] = useState<DataTableSort | undefined>(
    sort,
  );
  const [internalFilters, setInternalFilters] =
    useState<DataTableFilter[]>(filters);
  const [internalSelectedRows, setInternalSelectedRows] =
    useState<T[]>(selectedRows);

  // Determine if component is controlled
  const currentPage = onPageChange ? page : internalPage;
  const currentPageSize = onPageSizeChange ? pageSize : internalPageSize;
  const currentSort = onSortChange ? sort : internalSort;
  const currentFilters = onFiltersChange ? filters : internalFilters;
  const currentSelectedRows = onRowSelect ? selectedRows : internalSelectedRows;

  // Filter columns
  const visibleColumns = useMemo(
    () =>
      initialColumns.filter(
        (col) => !col.hidden && !hiddenColumns.has(String(col.accessor)),
      ),
    [initialColumns, hiddenColumns],
  );

  // Process data
  const processedData = useMemo(() => {
    let result = [...data];

    // Apply global filter
    if (filterable && globalFilter) {
      result = result.filter((row) => {
        return visibleColumns.some((col) => {
          const value = getNestedValue(row, String(col.accessor));
          return String(value)
            .toLowerCase()
            .includes(globalFilter.toLowerCase());
        });
      });
    }

    // Apply column filters
    if (filterable && currentFilters.length > 0) {
      result = result.filter((row) => {
        return currentFilters.every((filter) => {
          const value = String(
            getNestedValue(row, filter.column),
          ).toLowerCase();
          const filterValue = filter.value.toLowerCase();

          switch (filter.operator) {
            case "equals":
              return value === filterValue;
            case "startsWith":
              return value.startsWith(filterValue);
            case "endsWith":
              return value.endsWith(filterValue);
            default:
              return value.includes(filterValue);
          }
        });
      });
    }

    // Apply sorting
    if (sortable && currentSort?.direction) {
      result.sort((a, b) => {
        const aVal = getNestedValue(a, currentSort.column);
        const bVal = getNestedValue(b, currentSort.column);

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return currentSort.direction === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [
    data,
    visibleColumns,
    filterable,
    globalFilter,
    currentFilters,
    sortable,
    currentSort,
  ]);

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!paginate) return processedData;

    const startIndex = (currentPage - 1) * currentPageSize;
    return processedData.slice(startIndex, startIndex + currentPageSize);
  }, [processedData, paginate, currentPage, currentPageSize]);

  // Total pages
  const totalPages = useMemo(() => {
    const total = totalRecords ?? processedData.length;
    return Math.ceil(total / currentPageSize);
  }, [totalRecords, processedData.length, currentPageSize]);

  // Handlers
  const handleSort = useCallback(
    (column: string) => {
      if (!sortable) return;

      const newSort: DataTableSort = {
        column,
        direction:
          currentSort?.column === column
            ? currentSort.direction === "asc"
              ? "desc"
              : currentSort.direction === "desc"
                ? null
                : "asc"
            : "asc",
      };

      if (onSortChange) {
        onSortChange(newSort);
      } else {
        setInternalSort(newSort);
      }
    },
    [sortable, currentSort, onSortChange],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (onPageChange) {
        onPageChange(newPage);
      } else {
        setInternalPage(newPage);
      }
    },
    [onPageChange],
  );

  const handlePageSizeChange = useCallback(
    (size: string | null) => {
      const newSize = Number(size) || currentPageSize;

      if (onPageSizeChange) {
        onPageSizeChange(newSize);
        onPageChange?.(1);
      } else {
        setInternalPageSize(newSize);
        setInternalPage(1);
      }
    },
    [currentPageSize, onPageSizeChange, onPageChange],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      const newSelection = checked ? paginatedData : [];

      if (onRowSelect) {
        onRowSelect(newSelection);
      } else {
        setInternalSelectedRows(newSelection);
      }
    },
    [paginatedData, onRowSelect],
  );

  const handleSelectRow = useCallback(
    (row: T, checked: boolean) => {
      const newSelection = checked
        ? [...currentSelectedRows, row]
        : currentSelectedRows.filter((r) => r !== row);

      if (onRowSelect) {
        onRowSelect(newSelection);
      } else {
        setInternalSelectedRows(newSelection);
      }
    },
    [currentSelectedRows, onRowSelect],
  );

  const handleColumnToggle = useCallback(
    (column: string) => {
      const newHidden = new Set(hiddenColumns);
      if (newHidden.has(column)) {
        newHidden.delete(column);
      } else {
        newHidden.add(column);
      }
      setHiddenColumns(newHidden);
    },
    [hiddenColumns],
  );

  const isAllSelected =
    currentSelectedRows.length > 0 &&
    currentSelectedRows.length === paginatedData.length;
  const isIndeterminate =
    currentSelectedRows.length > 0 &&
    currentSelectedRows.length < paginatedData.length;

  // Render sort icon
  const renderSortIcon = (column: string) => {
    if (!sortable) return null;

    if (currentSort?.column === column) {
      if (currentSort.direction === "asc") {
        return (
          <IconChevronUp className="alepha-datatable-sort-icon" size={16} />
        );
      }
      if (currentSort.direction === "desc") {
        return (
          <IconChevronDown className="alepha-datatable-sort-icon" size={16} />
        );
      }
    }

    return (
      <IconChevronUp
        className="alepha-datatable-sort-icon-inactive"
        size={16}
      />
    );
  };

  // Render toolbar
  const toolbar = showToolbar &&
    (title ||
      actions ||
      filterable ||
      showColumnToggle ||
      showRefresh ||
      showExport) && (
      <Paper className="alepha-datatable-toolbar" p="md" mb="sm">
        <Flex justify="space-between" align="center" gap="md">
          <Group>
            {title && (
              <Text size="lg" fw={600}>
                {title}
              </Text>
            )}
            {currentSelectedRows.length > 0 && (
              <Badge color="blue" variant="light">
                {currentSelectedRows.length} selected
              </Badge>
            )}
          </Group>

          <Group>
            {filterable && (
              <TextInput
                placeholder={filterPlaceholder}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                leftSection={<IconSearch size={16} />}
                rightSection={
                  globalFilter && (
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      onClick={() => setGlobalFilter("")}
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  )
                }
                className="alepha-datatable-search-input"
              />
            )}

            {showColumnToggle && (
              <Menu position="bottom-end">
                <Menu.Target>
                  <Tooltip label="Toggle columns">
                    <ActionIcon variant="subtle">
                      <IconColumns size={20} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Visible columns</Menu.Label>
                  {initialColumns.map((col) => (
                    <Menu.Item
                      key={String(col.accessor)}
                      onClick={() => handleColumnToggle(String(col.accessor))}
                      leftSection={
                        <Checkbox
                          checked={
                            !hiddenColumns.has(String(col.accessor)) &&
                            !col.hidden
                          }
                          readOnly
                          size="xs"
                        />
                      }
                    >
                      {col.title || String(col.accessor)}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}

            {showRefresh && (
              <Tooltip label="Refresh">
                <ActionIcon
                  variant="subtle"
                  onClick={onRefresh}
                  loading={loading}
                >
                  <IconRefresh size={20} />
                </ActionIcon>
              </Tooltip>
            )}

            {showExport && (
              <Tooltip label="Export">
                <ActionIcon variant="subtle" onClick={onExport}>
                  <IconDownload size={20} />
                </ActionIcon>
              </Tooltip>
            )}

            {actions}
          </Group>
        </Flex>
      </Paper>
    );

  // Render table
  const tableContent = (
    <Table
      striped={striped}
      highlightOnHover={highlightOnHover}
      stickyHeader={stickyHeader}
      className="alepha-datatable-table"
      {...tableProps}
    >
      {showHeader && (
        <Table.Thead>
          <Table.Tr>
            {selectable && (
              <Table.Th className="alepha-datatable-checkbox-column">
                <Checkbox
                  checked={isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={(e) => handleSelectAll(e.currentTarget.checked)}
                />
              </Table.Th>
            )}

            {visibleColumns.map((column) => (
              <Table.Th
                key={String(column.accessor)}
                className={`alepha-datatable-th ${column.headerClassName || ""}`}
                style={{
                  width: column.width,
                  textAlign: column.align,
                  cursor: column.sortable && sortable ? "pointer" : "default",
                }}
                onClick={() =>
                  column.sortable && handleSort(String(column.accessor))
                }
              >
                <Group
                  gap="xs"
                  justify={
                    column.align === "center"
                      ? "center"
                      : column.align === "right"
                        ? "flex-end"
                        : "flex-start"
                  }
                >
                  {column.renderHeader
                    ? column.renderHeader()
                    : column.title || String(column.accessor)}
                  {column.sortable && renderSortIcon(String(column.accessor))}
                </Group>
              </Table.Th>
            ))}

            {rowActions && (
              <Table.Th className="alepha-datatable-actions-column">
                Actions
              </Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
      )}

      <Table.Tbody>
        {loading ? (
          <Table.Tr>
            <Table.Td
              colSpan={
                visibleColumns.length +
                (selectable ? 1 : 0) +
                (rowActions ? 1 : 0)
              }
            >
              <Center py="xl">
                <Loader size="sm" />
              </Center>
            </Table.Td>
          </Table.Tr>
        ) : paginatedData.length === 0 ? (
          <Table.Tr>
            <Table.Td
              colSpan={
                visibleColumns.length +
                (selectable ? 1 : 0) +
                (rowActions ? 1 : 0)
              }
            >
              <Center py="xl">
                <Text c="dimmed">{emptyMessage}</Text>
              </Center>
            </Table.Td>
          </Table.Tr>
        ) : (
          paginatedData.map((row, index) => {
            const isSelected = currentSelectedRows.includes(row);
            return (
              <Table.Tr
                key={index}
                className={`alepha-datatable-tr ${isSelected ? "alepha-datatable-selected" : ""} ${rowClassName?.(row, index) || ""}`}
                onClick={() => onRowClick?.(row, index)}
                style={{ cursor: onRowClick ? "pointer" : "default" }}
              >
                {selectable && (
                  <Table.Td className="alepha-datatable-checkbox-column">
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) =>
                        handleSelectRow(row, e.currentTarget.checked)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Table.Td>
                )}

                {visibleColumns.map((column) => {
                  const value = getNestedValue(row, String(column.accessor));
                  return (
                    <Table.Td
                      key={String(column.accessor)}
                      className={column.className}
                      style={{
                        textAlign: column.align,
                        ...(column.ellipsis && {
                          maxWidth: column.width,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }),
                      }}
                    >
                      {column.render ? column.render(value, row, index) : value}
                    </Table.Td>
                  );
                })}

                {rowActions && (
                  <Table.Td className="alepha-datatable-actions-column">
                    {rowActions(row, index)}
                  </Table.Td>
                )}
              </Table.Tr>
            );
          })
        )}
      </Table.Tbody>

      {showFooter && paginate && (
        <Table.Tfoot>
          <Table.Tr>
            <Table.Td
              colSpan={
                visibleColumns.length +
                (selectable ? 1 : 0) +
                (rowActions ? 1 : 0)
              }
            >
              <Flex justify="space-between" align="center" py="xs">
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Showing {(currentPage - 1) * currentPageSize + 1} to{" "}
                    {Math.min(
                      currentPage * currentPageSize,
                      totalRecords ?? processedData.length,
                    )}{" "}
                    of {totalRecords ?? processedData.length} records
                  </Text>

                  <Select
                    size="xs"
                    value={String(currentPageSize)}
                    onChange={handlePageSizeChange}
                    data={pageSizeOptions.map((size) => ({
                      value: String(size),
                      label: `${size} / page`,
                    }))}
                    className="alepha-datatable-page-size-select"
                  />
                </Group>

                <Pagination
                  size="sm"
                  value={currentPage}
                  onChange={handlePageChange}
                  total={totalPages}
                  siblings={1}
                  boundaries={1}
                />
              </Flex>
            </Table.Td>
          </Table.Tr>
        </Table.Tfoot>
      )}
    </Table>
  );

  return (
    <Box className="alepha-datatable-container">
      {toolbar}

      {height || maxHeight ? (
        <ScrollArea.Autosize mah={maxHeight} h={height} mih={minHeight}>
          {tableContent}
        </ScrollArea.Autosize>
      ) : (
        tableContent
      )}
    </Box>
  );
}
