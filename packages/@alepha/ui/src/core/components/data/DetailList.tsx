import { Flex, Grid, Text } from "@mantine/core";
import type { ReactNode } from "react";
import ClipboardButton from "../buttons/ClipboardButton.tsx";

export interface DetailListItem {
  label: string;
  value: ReactNode;
  hidden?: boolean;
  copyable?: string;
}

export interface DetailListProps {
  items: DetailListItem[];
  columns?: number;
}

const DetailList = (props: DetailListProps) => {
  const { items, columns = 1 } = props;
  const visibleItems = items.filter((item) => !item.hidden);

  return (
    <Grid gutter="xs">
      {visibleItems.map((item) => (
        <Grid.Col key={item.label} span={12 / columns}>
          <Flex
            py={6}
            justify="space-between"
            align="center"
            style={{
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {item.label}
            </Text>
            <Flex gap={4} align="center" style={{ minWidth: 0 }}>
              {typeof item.value === "string" ||
              typeof item.value === "number" ? (
                <Text size="sm" fw={500} truncate>
                  {item.value || "\u2014"}
                </Text>
              ) : (
                (item.value ?? (
                  <Text size="sm" c="dimmed">
                    {"\u2014"}
                  </Text>
                ))
              )}
              {item.copyable && (
                <ClipboardButton
                  value={item.copyable}
                  size="xs"
                  variant="subtle"
                  c="dimmed"
                />
              )}
            </Flex>
          </Flex>
        </Grid.Col>
      ))}
    </Grid>
  );
};

export default DetailList;
