import { Flex, Text } from "@alepha/ui";
import { Stack } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";

const AdminParameters = () => {
  return (
    <Flex flex={1} justify="center" align="center">
      <Stack align="center" gap="xs">
        <IconSettings
          size={48}
          stroke={1.5}
          color="var(--mantine-color-dimmed)"
        />
        <Text c="dimmed">Parameter Management</Text>
        <Text size="xs" c="dimmed" ta="center" maw={400}>
          Application parameters and configuration settings. Define parameters
          using the $config primitive to manage dynamic application settings.
        </Text>
      </Stack>
    </Flex>
  );
};

export default AdminParameters;
