import {
  type Async,
  type Page,
  type PageMetadata,
  type Static,
  type TObject,
  t,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import { useAction } from "@alepha/react";
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

export interface DataTableProps<T extends object, F extends TObject> {
  /**
   * The items to display in the table. Can be a static page of items or a function that returns a promise resolving to a page of items.
   */
  items:
    | MaybePage<T>
    | ((
        filters: Static<F> & { page: number; size: number; sort?: string },
      ) => Async<MaybePage<T>>);

  /**
   * The columns to display in the table. Each column is defined by a key and a DataTableColumn object.
   */
  columns: {
    [key: string]: DataTableColumn<T>;
  };

  /**
   * Optional filters to apply to the data.
   */
  filters?: F;

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

const DataTable = <T extends object, F extends TObject>(
  props: DataTableProps<T, F>,
) => {
  const [items, setItems] = useState<MaybePage<T>>(
    typeof props.items === "function"
      ? {
          content: [],
        }
      : props.items,
  );

  const submit = useAction(
    {
      runOnInit: props.submitOnInit,
      handler: async (filters: Static<F>, sig: any) => {
        if (typeof props.items === "function") {
          const response = await props.items(
            filters as Static<F> & {
              page: number;
              size: number;
              sort?: string;
            },
          );
          setItems(response);
        }
      },
    },
    [],
  );

  const [page, setPage] = useState(1);
  const [size, setSize] = useState("10");

  const form = useForm(
    {
      schema: t.object({
        ...(props.filters ? props.filters.properties : {}),
        page: t.number({ default: 0 }),
        size: t.number({ default: 10 }),
        sort: t.optional(t.string()),
      }),
      handler: async (values, args) => {
        await submit.run(values as Static<F>);
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
          setSize(value);
          form.input.page.set(0);
          return;
        }

        submitDebounce();
      },
    },
    [],
  );

  const submitDebounce = useDebouncedCallback(() => form.submit(), {
    delay: 1000,
  });

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
    <Flex direction={"column"} gap={"sm"}>
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
