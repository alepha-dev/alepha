import { useInject } from "@alepha/react";
import { type FormModel, useForm } from "@alepha/react/form";
import {
  Card,
  Flex,
  Pagination,
  Select,
  Table,
  type TableProps,
  type TableTrProps,
} from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import {
  Alepha,
  type Async,
  type Page,
  type PageMetadata,
  type Static,
  type TObject,
  t,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { type ReactNode, useEffect, useState } from "react";
import { ui } from "../../constants/ui.ts";
import ActionButton from "../buttons/ActionButton.tsx";
import TypeForm, { type TypeFormProps } from "../form/TypeForm.tsx";

export interface DataTableColumnContext<Filters extends TObject> {
  index: number;
  form: FormModel<Filters>;
  alepha: Alepha;
}

export interface DataTableColumn<T extends object, Filters extends TObject> {
  label: string;
  value: (item: T, ctx: DataTableColumnContext<Filters>) => ReactNode;
  fit?: boolean;
}

export type MaybePage<T> = Omit<Page<T>, "page"> & {
  page?: Partial<PageMetadata>;
};

export interface DataTableSubmitContext<T extends object> {
  items: T[];
}

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
  withCheckbox?: boolean;
  checkboxActions?: any[];

  actions?: any[];

  /**
   * Enable infinity scroll mode. When true, pagination controls are hidden and new items are loaded automatically when scrolling to the bottom.
   */
  infinityScroll?: boolean;

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

  const form = useForm(
    {
      schema: t.object({
        ...(props.filters ? props.filters.properties : {}),
        page: t.number({ default: 0 }),
        size: t.number({ default: defaultSize }),
        sort: t.optional(t.string()),
      }),
      handler: async (values, args) => {
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

        props.onFilterChange?.(key, value, form as any);
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

  const head = Object.entries(props.columns).map(([key, col]) => (
    <Table.Th
      key={key}
      style={{
        ...(col.fit
          ? {
              width: "1%",
              whiteSpace: "nowrap",
            }
          : {}),
      }}
    >
      <ActionButton justify={"space-between"} radius={0} fullWidth size={"xs"}>
        {col.label}
      </ActionButton>
    </Table.Th>
  ));

  const rows = items.content.map((item, index) => {
    const trProps = props.tableTrProps
      ? props.tableTrProps(item as T)
      : ({} as TableTrProps);
    return (
      <Table.Tr key={JSON.stringify(item)} {...trProps}>
        {Object.entries(props.columns).map(([key, col]) => (
          <Table.Td key={key}>
            {col.value(item as T, {
              index,
              form: form as unknown as FormModel<Filters>,
              alepha,
            })}
          </Table.Td>
        ))}
      </Table.Tr>
    );
  });

  const schema = t.omit(form.options.schema, ["page", "size", "sort"]);

  return (
    <Flex direction={"column"} gap={"sm"} flex={1}>
      {props.filters ? (
        <Card withBorder p={"lg"} bg={ui.colors.elevated}>
          <TypeForm
            {...props.typeFormProps}
            form={form as unknown as FormModel<Filters>}
            schema={schema}
          />
        </Card>
      ) : null}

      <Flex className={"overflow-auto"}>
        <Table
          striped
          withRowBorders
          withColumnBorders
          withTableBorder
          stripedColor={""}
          {...props.tableProps}
        >
          <Table.Thead>
            <Table.Tr>{head}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      </Flex>

      {!props.infinityScroll && (
        <Flex justify={"space-between"} align={"center"}>
          <Pagination
            withEdges
            total={items.page?.totalPages ?? 1}
            value={page}
            onChange={(value) => {
              form.input.page.set(value - 1);
            }}
          />
          <Flex>
            <Select
              value={size}
              onChange={(value) => {
                form.input.size.set(Number(value));
              }}
              data={[
                { value: "5", label: "5" },
                { value: "10", label: "10" },
                { value: "25", label: "25" },
                { value: "50", label: "50" },
                { value: "100", label: "100" },
              ]}
            />
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};

export default DataTable;
