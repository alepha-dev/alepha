import { ActionButton, Flex, isComponentType, Text, ui } from "@alepha/ui";
import { Checkbox, Drawer, Loader, Table, UnstyledButton } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconDotsVertical,
} from "@tabler/icons-react";
import { Alepha, type Static, type TObject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { type FormModel, useForm } from "alepha/react/form";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ColumnVisibility,
  DataTableColumnContext,
  DataTableProps,
  FilterVisibility,
  MaybePage,
} from "../interfaces/types.ts";
import { DEFAULT_MAX_VISIBLE_COLUMNS } from "../interfaces/types.ts";
import DataTableFilters, {
  type DataTableFiltersProps,
} from "./DataTableFilters.tsx";
import DataTablePagination from "./DataTablePagination.tsx";
import DataTableToolbar from "./DataTableToolbar.tsx";
import { useTableSelection } from "./useTableSelection.ts";

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

const toAriaSort = (
  dir: SortDirection,
): "ascending" | "descending" | "none" => {
  if (dir === "asc") return "ascending";
  if (dir === "desc") return "descending";
  return "none";
};

const FIT_STYLE = { width: 1, whiteSpace: "nowrap" } as const;

const DataTable = <T extends object, Filters extends TObject>(
  props: DataTableProps<T, Filters>,
) => {
  const [items, setItems] = useState<MaybePage<T>>(
    typeof props.items === "function" ? { content: [] } : props.items,
  );
  const itemsRef = useRef(items);
  const [loaded, setLoaded] = useState(
    typeof props.items !== "function" || !props.submitOnInit,
  );

  const defaultSize = props.defaultSize || (props.infinityScroll ? 100 : 10);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(String(defaultSize));
  const [currentPage, setCurrentPage] = useState(0);
  const alepha = useInject(Alepha);
  itemsRef.current = items;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (!props.filters?.properties) return {};
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

  // Current sort string
  const [sortString, setSortString] = useState<string | undefined>(undefined);

  // Handle column header click for sorting
  const handleSortClick = (columnKey: string, sortKey?: string) => {
    const field = sortKey || columnKey;
    const newSort = toggleSort(sortString, field);
    setSortString(newSort);
    form.input.sort.set(newSort);
    form.input.page.set(0); // Reset to first page when sorting changes
  };

  // Item key resolver — prefers explicit prop, falls back to .id, then JSON
  const getItemKey = useCallback(
    (item: T): string => {
      if (props.getItemKey) return props.getItemKey(item);
      if ("id" in item) return String((item as Record<string, unknown>).id);
      return JSON.stringify(item);
    },
    [props.getItemKey],
  );

  // Checkbox selection (extracted hook)
  const selection = useTableSelection(
    items.content as T[],
    getItemKey,
    props.withCheckbox ?? false,
  );

  // Panel — normalize shorthand vs object form
  const panelConfig = useMemo(() => {
    if (!props.panel) return null;
    if (typeof props.panel === "function") {
      return { render: props.panel, can: undefined };
    }
    return props.panel;
  }, [props.panel]);

  // Drawer — normalize shorthand vs object form
  const [drawerItem, setDrawerItem] = useState<T | null>(null);
  const drawerConfig = useMemo(() => {
    if (!props.drawer) return null;
    if (typeof props.drawer === "function") {
      return { render: props.drawer, can: undefined, props: undefined };
    }
    return props.drawer;
  }, [props.drawer]);

  // Panel expand state
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
              items: itemsRef.current.content,
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
          if (!loaded) setLoaded(true);
        }
      },
      onReset: async () => {
        setPage(1);
        setSize(String(defaultSize));
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

        if (props.skipSubmitOnChange) return;

        form.input.page.set(0);

        const delay = props.debounce ?? 300;
        if (delay > 0) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            form.submit();
          }, delay);
        } else {
          await form.submit();
        }
      },
    },
    [],
  );

  const dt = useInject(DateTimeProvider);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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

  // Infinity scroll via IntersectionObserver
  useEffect(() => {
    if (!props.infinityScroll || typeof props.items !== "function") return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || form.submitting) return;

        const totalPages = items.page?.totalPages ?? 1;
        if (currentPage + 1 < totalPages) {
          form.input.page.set(currentPage + 1);
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    props.infinityScroll,
    form.submitting,
    items.page?.totalPages,
    currentPage,
    form,
  ]);

  // Total column count (for colSpan)
  const totalColumns =
    visibleColumns.length +
    (panelConfig ? 1 : 0) +
    (props.withCheckbox ? 1 : 0) +
    (props.rowActions ? 1 : 0);

  // Checkbox header column
  const checkboxHeader = props.withCheckbox ? (
    <Table.Th style={{ width: 40 }}>
      <Checkbox
        checked={selection.allSelected}
        indeterminate={selection.someSelected}
        onChange={selection.toggleAll}
        aria-label="Select all"
      />
    </Table.Th>
  ) : null;

  const head = visibleColumns.map(([key, col]) => {
    const sortField = col.sortKey || key;
    const sortDir = col.sortable
      ? getSortDirection(sortString, sortField)
      : null;

    return (
      <Table.Th
        key={key}
        onClick={
          col.sortable ? () => handleSortClick(key, col.sortKey) : undefined
        }
        aria-sort={col.sortable ? toAriaSort(sortDir) : undefined}
        style={{
          ...(col.fit ? FIT_STYLE : {}),
          ...(col.sortable ? { cursor: "pointer", userSelect: "none" } : {}),
        }}
      >
        <Flex align="center" gap={4}>
          <Text bold muted size="xs">
            {col.label}
          </Text>
          {col.sortable && (
            <Flex c="dimmed">
              {sortDir === "asc" && <IconArrowUp size={ui.sizes.icon.xs} />}
              {sortDir === "desc" && <IconArrowDown size={ui.sizes.icon.xs} />}
              {sortDir === null && <IconArrowsSort size={ui.sizes.icon.xs} />}
            </Flex>
          )}
        </Flex>
      </Table.Th>
    );
  });

  const rows = items.content.flatMap((item, index) => {
    const trProps = props.tableTrProps ? props.tableTrProps(item as T) : {};
    const itemKey = getItemKey(item as T);
    const isSelected = selection.isSelected(item as T);
    const showPanel =
      panelConfig && (panelConfig.can ? panelConfig.can(item as T) : true);
    const isExpanded = expandedKeys.has(itemKey);
    const canOpenDrawer =
      drawerConfig && (drawerConfig.can ? drawerConfig.can(item as T) : true);

    const elements = [
      <Table.Tr
        key={itemKey}
        {...trProps}
        style={{
          ...(canOpenDrawer ? { cursor: "pointer" } : {}),
          ...(trProps.style ?? {}),
        }}
        onClick={(e) => {
          if (canOpenDrawer) setDrawerItem(item as T);
          trProps.onClick?.(e);
        }}
      >
        {panelConfig && (
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
          <Table.Td style={{ width: 40 }} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onChange={() => selection.toggleItem(item as T)}
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

          const content = col.value?.(item as T, ctx);

          return (
            <Table.Td key={key} style={col.fit ? FIT_STYLE : undefined}>
              {col.action ? (
                <ActionButton
                  td={"inherit"}
                  unstyled
                  {...col.action(item as T)}
                >
                  {content}
                </ActionButton>
              ) : (
                content
              )}
            </Table.Td>
          );
        })}
        {props.rowActions &&
          (() => {
            const ctx = {
              index,
              form: form as unknown as FormModel<Filters>,
              alepha,
            } as DataTableColumnContext<Filters>;
            const actions = props.rowActions!(item as T, ctx).filter(
              (a) => a.visible !== false,
            );
            if (actions.length === 0) return <Table.Td style={FIT_STYLE} />;
            return (
              <Table.Td
                py={2}
                px={4}
                style={FIT_STYLE}
                onClick={(e) => e.stopPropagation()}
              >
                <ActionButton
                  variant={"minimal"}
                  size="xs"
                  icon={IconDotsVertical}
                  menu={{
                    items: actions.map((action) => {
                      const Icon = action.icon;
                      return {
                        label:
                          action.label ??
                          (typeof action.tooltip === "string"
                            ? action.tooltip
                            : undefined),
                        icon:
                          Icon && isComponentType(Icon) ? (
                            <Icon size={14} />
                          ) : (
                            (Icon as ReactNode)
                          ),
                        onClick: (action as any).onClick
                          ? async () => {
                              await (action as any).onClick();
                              if (!action.skipRefresh) {
                                await form.submit();
                              }
                            }
                          : undefined,
                        color: action.color,
                      };
                    }),
                  }}
                />
              </Table.Td>
            );
          })()}
      </Table.Tr>,
    ];

    if (panelConfig && showPanel && isExpanded) {
      elements.push(
        <Table.Tr key={`${itemKey}-panel`}>
          <Table.Td colSpan={totalColumns} p={0}>
            {panelConfig.render(item as T)}
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
    <Flex
      gap={"xs"}
      flex={1}
      p={0}
      direction="column"
      style={{ overflow: "hidden" }}
    >
      <Flex rounded bordered elevated shadowed={"xs"} col>
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
          selectedItems={selection.selectedItems}
          checkboxActions={props.checkboxActions}
          onClearSelection={selection.clear}
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
      </Flex>

      <Flex
        col
        rounded
        bordered
        elevated
        shadowed={"xs"}
        flex={1}
        style={{ minHeight: 0 }}
      >
        <Flex className="overflow-auto" flex={1} style={{ minHeight: 0 }} col>
          <Table
            aria-label="Data table"
            withRowBorders
            highlightOnHover
            {...props.tableProps}
          >
            <Table.Thead
              bdrs={"md"}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                backgroundColor: "var(--alepha-elevated)",
              }}
            >
              <Table.Tr>
                {panelConfig && <Table.Th style={{ width: 36 }} />}
                {checkboxHeader}
                {head}
                {props.rowActions && <Table.Th style={FIT_STYLE} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {!loaded || form.submitting ? (
                <Table.Tr>
                  <Table.Td colSpan={totalColumns || 1} py="sm">
                    <Flex justify="center" p={"md"}>
                      <Loader size="sm" type="dots" />
                    </Flex>
                  </Table.Td>
                </Table.Tr>
              ) : rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={totalColumns || 1} py="xl">
                    <Flex justify="center">
                      <Text c="dimmed" size="sm">
                        {props.emptyLabel ?? "No results"}
                      </Text>
                    </Flex>
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows
              )}
            </Table.Tbody>
          </Table>
        </Flex>

        {props.infinityScroll && <div ref={sentinelRef} />}

        {!props.infinityScroll && (
          <DataTablePagination
            page={page}
            size={size}
            totalPages={items.page?.totalPages}
            totalElements={items.page?.totalElements}
            isFirst={items.page?.isFirst}
            isLast={items.page?.isLast}
            offset={items.page?.offset ?? 0}
            numberOfElements={items.content.length}
            onPageChange={(value) => {
              form.input.page.set(value - 1);
            }}
            onSizeChange={(value) => {
              form.input.size.set(value);
            }}
          />
        )}

        {drawerConfig && (
          <Drawer
            opened={drawerItem !== null}
            onClose={() => setDrawerItem(null)}
            position="right"
            size="xl"
            {...drawerConfig.props}
          >
            {drawerItem && drawerConfig.render(drawerItem)}
          </Drawer>
        )}
      </Flex>
    </Flex>
  );
};

export default DataTable;
