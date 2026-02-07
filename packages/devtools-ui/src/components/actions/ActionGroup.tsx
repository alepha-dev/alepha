import { ui } from "@alepha/ui";
import { Accordion, Badge, Box, Group, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import type { DevActionMetadata } from "alepha/devtools";
import { ActionItem } from "./ActionItem.tsx";

interface ActionGroupProps {
  group: string;
  actions: DevActionMetadata[];
}

export const ActionGroup = ({ group, actions }: ActionGroupProps) => (
  <Box>
    <Group gap="xs" mb="xs">
      <IconChevronRight size={14} opacity={0.5} />
      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
        {group}
      </Text>
      <Badge variant="light" color="gray" size="xs">
        {actions.length}
      </Badge>
    </Group>
    <Accordion
      variant="separated"
      styles={{
        item: {
          backgroundColor: ui.colors.surface,
          border: `1px solid ${ui.colors.border}`,
        },
      }}
    >
      {actions.map((action) => (
        <ActionItem key={action.fullPath} action={action} />
      ))}
    </Accordion>
  </Box>
);
