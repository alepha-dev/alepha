import { Flex, Text } from "@alepha/ui";
import { Pagination, Select } from "@mantine/core";

export interface DataTablePaginationProps {
  page: number;
  size: string;
  totalPages?: number;
  totalElements?: number;
  isFirst?: boolean;
  isLast?: boolean;
  offset: number;
  numberOfElements: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

const DataTablePagination = ({
  page,
  size,
  totalPages,
  totalElements,
  isFirst,
  isLast,
  offset,
  numberOfElements,
  onPageChange,
  onSizeChange,
}: DataTablePaginationProps) => {
  const from = numberOfElements > 0 ? offset + 1 : 0;
  const to = offset + numberOfElements;
  const hasTotal = totalPages != null;

  return (
    <Flex
      align="center"
      justify="space-between"
      gap="md"
      px="xs"
      py={4}
      style={{
        borderTop: "1px solid var(--alepha-border)",
      }}
    >
      <Flex align="center">
        <Text size="xs" c="dimmed">
          {totalElements != null
            ? `Showing ${from} - ${to} of ${totalElements}`
            : `Showing ${from} - ${to}`}
        </Text>
      </Flex>
      <Flex align="center" gap="md">
        <Flex>
          <Select
            color={"gray"}
            c={"gray"}
            size={"xs"}
            w={96}
            variant="default"
            value={size}
            onChange={(value) => {
              if (value) {
                onSizeChange(Number(value));
              }
            }}
            data={[
              { value: "10", label: "10" },
              { value: "25", label: "25" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
          />
        </Flex>
        <Flex>
          <Pagination
            size={"sm"}
            withEdges={hasTotal}
            withPages={hasTotal}
            total={hasTotal ? totalPages : (isLast !== false ? page : page + 1)}
            value={page}
            onChange={onPageChange}
          />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default DataTablePagination;
