import { Flex, Text } from "@alepha/ui";

import { IconShieldCheck } from "@tabler/icons-react";

const AdminVerifications = () => {
  return (
    <Flex flex={1} justify="center" align="center">
      <Flex direction="column" align="center" gap="xs">
        <IconShieldCheck
          size={48}
          stroke={1.5}
          color="var(--mantine-color-dimmed)"
        />
        <Text c="dimmed">Verification Management</Text>
        <Text size="xs" c="dimmed" ta="center" maw={400}>
          Verifications are automatically managed by the system. Email and SMS
          verification codes are generated and validated through the
          verification API endpoints.
        </Text>
      </Flex>
    </Flex>
  );
};

export default AdminVerifications;
