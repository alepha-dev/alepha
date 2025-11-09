import {
  type Async,
  type Page,
  type PageMetadata,
  type TObject,
  t,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { useInject } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import {
  Flex,
  Pagination,
  Paper,
  Select,
  Table,
  type TableProps,
  type TableTrProps,
} from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { type ReactNode, useEffect, useState } from "react";
import ActionButton from "../buttons/ActionButton.tsx";
import TypeForm from "../form/TypeForm.tsx";

export interface DataTableColumn<T extends object> {
  label: string;
  value: (item: T, index: number) => ReactNode;
}

export type MaybePage<T> = Omit<Page<T>, "page"> & {
  page?: Partial<PageMetadata>;
};

export interface DataTableProps<T extends object> {
  /**
   * The items to display in the table. Can be a static page of items or a function that returns a promise resolving to a page of items.
   */
  items:
    | MaybePage<T>
    | ((
        filters: Record<string, string> & {
          page: number;
          size: number;
          sort?: string;
        },
      ) => Async<MaybePage<T>>);

  /**
   * The columns to display in the table. Each column is defined by a key and a DataTableColumn object.
   */
  columns: {
    [key: string]: DataTableColumn<T>;
  };

  defaultSize?: number;

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

const DataTable = <T extends object>(props: DataTableProps<T>) => {
  const [items, setItems] = useState<MaybePage<T>>(
    typeof props.items === "function"
      ? {
          content: [],
        }
      : props.items,
  );

  const defaultSize = props.defaultSize || 10;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(String(defaultSize));

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
            values as Record<string, string> & {
              page: number;
              size: number;
              sort?: string;
            },
          );
          setItems(response);
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

        //submitDebounce();
      },
    },
    [],
  );

  const submitDebounce = useDebouncedCallback(() => form.submit(), {
    delay: 1000,
  });

  const dt = useInject(DateTimeProvider);

  useEffect(() => {
    if (props.submitOnInit) {
      console.log("submitting");
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

  const head = Object.entries(props.columns).map(([key, col]) => (
    <Table.Th key={key}>
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
          <Table.Td key={key}>{col.value(item as T, index)}</Table.Td>
        ))}
      </Table.Tr>
    );
  });

  const schema = t.omit(form.options.schema, ["page", "size", "sort"]);

  return (
    <Flex direction={"column"} gap={"sm"} flex={1}>
      <Paper withBorder p={"sm"}>
        {props.filters ? <TypeForm form={form} schema={schema} /> : null}
      </Paper>
      <Table striped stripedColor={""} {...props.tableProps}>
        <Table.Thead>
          <Table.Tr>{head}</Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>

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
    </Flex>
  );
};

export default DataTable;
