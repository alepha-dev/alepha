import { Flex, Paper, Text } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import { ui } from "../../constants/ui.ts";

export interface StatCardItem {
  label: string;
  value: ReactNode;
  icon?: ReactNode | ComponentType<{ size?: number }>;
}

export interface StatCardsProps {
  items: StatCardItem[];
}

const StatCards = ({ items }: StatCardsProps) => (
  <Flex gap="sm" wrap="wrap">
    {items.map((item) => {
      const IconComponent =
        item.icon && typeof item.icon === "function" ? item.icon : null;
      const iconNode = IconComponent ? (
        <IconComponent size={ui.sizes.icon.md} />
      ) : (
        (item.icon as ReactNode)
      );

      return (
        <Paper
          key={item.label}
          p="md"
          radius="md"
          withBorder
          style={{ flex: "1 1 0", minWidth: 120 }}
        >
          <Flex gap="sm" align="center">
            <Flex direction="column">
              <Text size="xl" fw={700} lh={1}>
                {item.value}
              </Text>
              <Text size="xs" c="dimmed">
                {item.label}
              </Text>
            </Flex>
          </Flex>
        </Paper>
      );
    })}
  </Flex>
);

export default StatCards;
