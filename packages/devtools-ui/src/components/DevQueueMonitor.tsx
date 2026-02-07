import { Flex, Text, ThemeIcon } from "@mantine/core";
import { IconStack2 } from "@tabler/icons-react";

export const DevQueueMonitor = () => {
  return (
    <Flex direction="column" gap="xl" w="100%" p={"xl"}>
      <Flex align="center" gap="sm">
        <ThemeIcon size={32} variant="light" color="orange">
          <IconStack2 size={20} />
        </ThemeIcon>
        <Text size="xl" fw={600}>
          Queue Monitor
        </Text>
      </Flex>

      <Text c="dimmed">Background job queues - coming soon</Text>
    </Flex>
  );
};

export default DevQueueMonitor;
