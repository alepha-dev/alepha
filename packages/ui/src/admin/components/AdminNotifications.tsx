import { Flex, Text } from "@alepha/ui";
import { Stack } from "@mantine/core";
import { IconBell } from "@tabler/icons-react";

const AdminNotifications = () => {
  return (
    <Flex flex={1} justify="center" align="center">
      <Stack align="center" gap="xs">
        <IconBell size={48} stroke={1.5} color="var(--mantine-color-dimmed)" />
        <Text c="dimmed">Notification Center</Text>
        <Text size="xs" c="dimmed" ta="center" maw={400}>
          Notifications are processed through the queue system. Email and SMS
          notifications are sent asynchronously using the configured providers.
        </Text>
      </Stack>
    </Flex>
  );
};

export default AdminNotifications;
