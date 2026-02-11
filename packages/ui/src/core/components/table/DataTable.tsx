import { Checkbox, Flex, Table, Text, UnstyledButton } from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import {
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { Alepha, type Static, type TObject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { type FormModel, useForm } from "alepha/react/form";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ui } from "../../constants/ui.ts";
import ActionButton from "../buttons/ActionButton.tsx";
import DataTableFilters, {
  type DataTableFiltersProps,
} from "./DataTableFilters.tsx";
import DataTablePagination from "./DataTablePagination.tsx";
import DataTableToolbar from "./DataTableToolbar.tsx";
import type {
  ColumnVisibility,
  DataTableColumnContext,
  DataTableProps,
  FilterVisibility,
  MaybePage,
} from "./types.ts";

const DEFAULT_MAX_VISIBLE_COLUMNS = 8;

type SortDirection = "asc" | "desc" | null;

/**
 * Parse the sort string to get direction for a specific field.
 * Alepha convention: 'field' = ASC, '-field' = DESC
 */
const getSortDirection = (
  sortString: string | undefined,
  field: string,
): SortDirection => {
  if (!sortString) return null;
  const parts = sortString.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (part === field) return "asc";
    if (part === `-${field}`) return "desc";
  }
  return null;
};

/**
 * Toggle sort for a field in the sort string.
 * Cycles: null -> asc -> desc -> null
 */
const toggleSort = (
  sortString: string | undefined,
  field: string,
): string | undefined => {
  const current = getSortDirection(sortString, field);

  // Remove existing sort for this field
  const parts = (sortString || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== field && s !== `-${field}`);

  if (current === null) {
    // No sort -> ASC
    parts.unshift(field);
  } else if (current === "asc") {
    // ASC -> DESC
    parts.unshift(`-${field}`);
  }
  // DESC -> remove (already filtered out above)

  return parts.length > 0 ? parts.join(",") : undefined;
};

const DataTable = <T extends object, Filters extends TObject>(
  props: DataTableProps<T, Filters>,
) => {
  const [items, setItems] = useState<MaybePage<T>>(
    typeof props.items === "function"
      ? {
          content: [],
        }
      : props.items,
  );

  const defaultSize = props.infinityScroll ? 100 : props.defaultSize || 10;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(String(defaultSize));
  const [currentPage, setCurrentPage] = useState(0);
  const alepha = useInject(Alepha);

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(
    () => {
      const entries = Object.entries(props.columns);
      let visibleCount = 0;
      return entries.reduce((acc, [key, col]) => {
        if (col.defaultHidden) {
          acc[key] = false;
        } else if (visibleCount < DEFAULT_MAX_VISIBLE_COLUMNS) {
          acc[key] = true;
          visibleCount++;
        } else {
          acc[key] = false;
        }
        return acc;
      }, {} as ColumnVisibility);
    },
  );

  // Filter visibility state — default: none visible
  const [filterVisibility, setFilterVisibility] = useState<FilterVisibility>(
    () => {
      if (!props.filters?.properties) {
        return {};
      }
      const defaults = new Set(props.defaultFilters ?? []);
      return Object.keys(props.filters.properties).reduce(
        (acc, key) => ({ ...acc, [key]: defaults.has(key) }),
        {} as FilterVisibility,
      );
    },
  );

  // Compute visible columns
  const visibleColumns = useMemo(() => {
    return Object.entries(props.columns).filter(
      ([key]) => columnVisibility[key] !== false,
    );
  }, [props.columns, columnVisibility]);

  // Current sort string from form
  const [sortString, setSortString] = useState<string | undefined>(undefined);

  // Handle column header click for sorting
  const handleSortClick = (columnKey: string, sortKey?: string) => {
    const field = sortKey || columnKey;
    const newSort = toggleSort(sortString, field);
    setSortString(newSort);
    form.input.sort.set(newSort);
    form.input.page.set(0); // Reset to first page when sorting changes
  };

  // Checkbox selection state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Default getItemKey uses JSON.stringify if not provided
  const getItemKey = useCallback(
    (item: T): string => {
      if (props.getItemKey) {
        return props.getItemKey(item);
      }
      return JSON.stringify(item);
    },
    [props.getItemKey],
  );

  // Get selected items from current content
  const selectedItems = useMemo(() => {
    if (!props.withCheckbox) return [];
    return items.content.filter((item) =>
      selectedKeys.has(getItemKey(item as T)),
    ) as T[];
  }, [items.content, selectedKeys, getItemKey, props.withCheckbox]);

  // Check if all current page items are selected
  const allSelected = useMemo(() => {
    if (items.content.length === 0) return false;
    return items.content.every((item) =>
      selectedKeys.has(getItemKey(item as T)),
    );
  }, [items.content, selectedKeys, getItemKey]);

  // Check if some (but not all) items are selected
  const someSelected = useMemo(() => {
    if (items.content.length === 0) return false;
    const selectedCount = items.content.filter((item) =>
      selectedKeys.has(getItemKey(item as T)),
    ).length;
    return selectedCount > 0 && selectedCount < items.content.length;
  }, [items.content, selectedKeys, getItemKey]);

  // Toggle selection of a single item
  const toggleItemSelection = useCallback(
    (item: T) => {
      const key = getItemKey(item);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [getItemKey],
  );

  // Toggle selection of all items on current page
  const toggleAllSelection = useCallback(() => {
    if (allSelected) {
      // Deselect all current page items
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of items.content) {
          next.delete(getItemKey(item as T));
        }
        return next;
      });
    } else {
      // Select all current page items
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of items.content) {
          next.add(getItemKey(item as T));
        }
        return next;
      });
    }
  }, [allSelected, items.content, getItemKey]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  // Panel expand state
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const form = useForm(
    {
      schema: t.object({
        ...(props.filters ? props.filters.properties : {}),
        page: t.number({ default: 0 }),
        size: t.number({ default: defaultSize }),
        sort: t.optional(t.string()),
      }),
      handler: async (values) => {
        if (typeof props.items === "function") {
          const response = await props.items(
            values as Static<Filters> & {
              page: number;
              size: number;
              sort?: string;
            },
            {
              items: items.content,
            },
          );

          if (props.infinityScroll && values.page > 0) {
            // Append new items to existing ones for infinity scroll
            setItems((prev) => ({
              ...response,
              content: [...prev.content, ...response.content],
            }));
          } else {
            setItems(response);
          }

          setCurrentPage(values.page);
        }
      },
      onReset: async () => {
        setPage(1);
        setSize("10");
        await form.submit();
      },
      onChange: async (key, value) => {
        if (key === "page") {
          setPage(value + 1);
          await form.submit();
          return;
        }

        if (key === "size") {
          setSize(String(value));
          form.input.page.set(0);
          return;
        }

        props.onFilterChange?.(
          key,
          value,
          form as unknown as FormModel<Filters>,
        );
      },
    },
    [items],
  );

  const submitDebounce = useDebouncedCallback(() => form.submit(), {
    delay: 800,
  });

  const dt = useInject(DateTimeProvider);

  useEffect(() => {
    if (props.submitOnInit) {
      form.submit();
    }
    if (props.submitEvery) {
      const it = dt.createInterval(() => {
        form.submit();
      }, props.submitEvery);
      return () => dt.clearInterval(it);
    }
  }, []);

  useEffect(() => {
    if (typeof props.items !== "function") {
      setItems(props.items);
    }
  }, [props.items]);

  // Infinity scroll detection
  useEffect(() => {
    if (!props.infinityScroll || typeof props.items !== "function") return;

    const handleScroll = () => {
      if (form.submitting) return;

      const scrollTop = window.scrollY;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;

      const isNearBottom = scrollTop + windowHeight >= docHeight - 300;

      if (isNearBottom) {
        const totalPages = items.page?.totalPages ?? 1;

        if (currentPage + 1 < totalPages) {
          form.input.page.set(currentPage + 1);
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [
    props.infinityScroll,
    form.submitting,
    items.page?.totalPages,
    currentPage,
    form,
  ]);

  // Checkbox header column
  const checkboxHeader = props.withCheckbox ? (
    <Table.Th style={{ width: 40 }}>
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        onChange={toggleAllSelection}
        aria-label="Select all"
      />
    </Table.Th>
  ) : null;

  const head = visibleColumns.map(([key, col]) => {
    const sortField = col.sortKey || key;
    const sortDir = col.sortable
      ? getSortDirection(sortString, sortField)
      : null;

    const headerContent = (
      <Flex align="center" gap={4}>
        <Text size="xs">{col.label}</Text>
        {col.sortable && (
          <Flex c="dimmed">
            {sortDir === "asc" && <IconArrowUp size={ui.sizes.icon.sm} />}
            {sortDir === "desc" && <IconArrowDown size={ui.sizes.icon.sm} />}
            {sortDir === null && <IconArrowsSort size={ui.sizes.icon.sm} />}
          </Flex>
        )}
      </Flex>
    );

    return (
      <Table.Th
        key={key}
        style={{
          ...(col.fit
            ? {
                // TODO: not working well (bad formatting in some cases)
                // width: "1%",
                // whiteSpace: "nowrap",
              }
            : {}),
          ...(col.sortable ? { cursor: "pointer" } : {}),
        }}
      >
        {col.sortable ? (
          <UnstyledButton onClick={() => handleSortClick(key, col.sortKey)}>
            {headerContent}
          </UnstyledButton>
        ) : (
          headerContent
        )}
      </Table.Th>
    );
  });

  const rows = items.content.flatMap((item, index) => {
    const trProps = props.tableTrProps ? props.tableTrProps(item as T) : {};
    const itemKey = getItemKey(item as T);
    const isSelected = selectedKeys.has(itemKey);
    const showPanel = props.panel && props.canPanel?.(item as T);
    const isExpanded = expandedKeys.has(itemKey);

    const elements = [
      <Table.Tr key={itemKey} {...trProps}>
        {props.panel && (
          <Table.Td style={{ width: 36, textAlign: "center" }} py={2} px={0}>
            {showPanel && (
              <UnstyledButton
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(itemKey);
                }}
                style={{ display: "inline-flex" }}
              >
                <Flex c="dimmed" align="center" justify="center">
                  {isExpanded ? (
                    <IconChevronDown size={ui.sizes.icon.sm} />
                  ) : (
                    <IconChevronRight size={ui.sizes.icon.sm} />
                  )}
                </Flex>
              </UnstyledButton>
            )}
          </Table.Td>
        )}
        {props.withCheckbox && (
          <Table.Td style={{ width: 40 }}>
            <Checkbox
              checked={isSelected}
              onChange={() => toggleItemSelection(item as T)}
              aria-label="Select row"
            />
          </Table.Td>
        )}
        {visibleColumns.map(([key, col]) => {
          const ctx = {
            index,
            form: form as unknown as FormModel<Filters>,
            alepha,
          } as DataTableColumnContext<Filters>;

          if (col.actions) {
            const rowActions = col
              .actions(item as T, ctx)
              .filter((a) => a.visible !== false);
            return (
              <Table.Td py={2} px={4} key={key}>
                <Flex gap={4}>
                  {rowActions.map(({ visible: _, ...actionProps }, i) => (
                    <ActionButton
                      key={i}
                      variant="subtle"
                      size="xs"
                      preventDefault
                      h={20}
                      {...actionProps}
                    />
                  ))}
                </Flex>
              </Table.Td>
            );
          }

          return (
            <Table.Td py={2} px={4} key={key}>
              {col.value?.(item as T, ctx)}
            </Table.Td>
          );
        })}
      </Table.Tr>,
    ];

    if (props.panel && showPanel && isExpanded) {
      const colSpan = visibleColumns.length + (props.withCheckbox ? 1 : 0) + 1;
      elements.push(
        <Table.Tr key={`${itemKey}-panel`}>
          <Table.Td colSpan={colSpan} p={0}>
            {props.panel(item as T)}
          </Table.Td>
        </Table.Tr>,
      );
    }

    return elements;
  });

  const filterSchema = useMemo(() => {
    if (!props.filters) return null;
    return t.omit(form.options.schema, ["page", "size", "sort"]);
  }, [props.filters, form.options.schema]);

  return (
    <Flex flex={1} p={0} bdrs="sm" direction="column">
      <DataTableToolbar
        columns={props.columns}
        filters={props.filters}
        columnVisibility={columnVisibility}
        filterVisibility={filterVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        onFilterVisibilityChange={setFilterVisibility}
        actions={props.actions}
        onRefresh={() => form.submit()}
        items={items.content as T[]}
        withExport={props.withExport}
        selectedItems={selectedItems}
        checkboxActions={props.checkboxActions}
        onClearSelection={clearSelection}
      />

      {filterSchema && props.filters && (
        <DataTableFilters
          schema={filterSchema}
          form={form as unknown as FormModel<TObject>}
          typeFormProps={
            props.typeFormProps as DataTableFiltersProps["typeFormProps"]
          }
          filterVisibility={filterVisibility}
        />
      )}

      <Flex className="overflow-auto">
        <Table withColumnBorders withRowBorders {...props.tableProps}>
          <Table.Thead>
            <Table.Tr>
              {props.panel && <Table.Th style={{ width: 36 }} />}
              {checkboxHeader}
              {head}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      </Flex>

      {!props.infinityScroll && (
        <DataTablePagination
          page={page}
          size={size}
          totalPages={items.page?.totalPages ?? 1}
          onPageChange={(value) => {
            form.input.page.set(value - 1);
          }}
          onSizeChange={(value) => {
            form.input.size.set(value);
          }}
        />
      )}
    </Flex>
  );
};

export default DataTable;
