import { Flex, Pagination, Select } from "@mantine/core";

export interface DataTablePaginationProps {
  page: number;
  size: string;
  totalPages: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

const DataTablePagination = ({
  page,
  size,
  totalPages,
  onPageChange,
  onSizeChange,
}: DataTablePaginationProps) => {
  return (
    <Flex
      align="center"
      justify="end"
      gap="md"
      p="xs"
      style={{
        borderTop: "1px solid var(--alepha-border)",
      }}
    >
      <Flex>
        <Select
          w={96}
          variant="default"
          value={size}
          onChange={(value) => {
            if (value) {
              onSizeChange(Number(value));
            }
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
      <Flex>
        <Pagination
          withEdges
          total={totalPages}
          value={page}
          onChange={onPageChange}
        />
      </Flex>
    </Flex>
  );
};

export default DataTablePagination;
