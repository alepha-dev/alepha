import type { Async } from "@alepha/core";
import type { TableTrProps } from "@mantine/core";
import { Table, type TableProps } from "@mantine/core";
import { type ReactNode, useEffect, useState } from "react";
import ActionButton from "../buttons/ActionButton.tsx";

export interface DataTableColumn<T extends object> {
  label: string;
  value: (item: T) => ReactNode;
}

export interface DataTableProps<T extends object> {
  items: T[] | (() => Async<T[]>);
  columns: {
    [key: string]: DataTableColumn<T>;
  };
  tableProps?: TableProps;
  tableTrProps?: (item: T) => TableTrProps;
}

const DataTable = <T extends object>(props: DataTableProps<T>) => {
  const [items, setItems] = useState<object[]>(
    typeof props.items === "function" ? [] : props.items,
  );

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

  const rows = items.map((item, index) => {
    const trProps = props.tableTrProps
      ? props.tableTrProps(item as T)
      : ({} as TableTrProps);
    return (
      <Table.Tr key={JSON.stringify(item)} {...trProps}>
        {Object.entries(props.columns).map(([key, col]) => (
          <Table.Td key={key}>{col.value(item as T)}</Table.Td>
        ))}
      </Table.Tr>
    );
  });

  return (
    <Table {...props.tableProps}>
      <Table.Thead>
        <Table.Tr>{head}</Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  );
};

export default DataTable;
