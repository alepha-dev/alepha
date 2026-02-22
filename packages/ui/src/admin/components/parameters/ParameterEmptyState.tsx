import { Flex, Text } from "@alepha/ui";
import { IconArrowLeft } from "@tabler/icons-react";

/**
 * Empty state displayed when no parameter is selected.
 * Invites user to select a parameter from the tree.
 */
const ParameterEmptyState = () => {
  return (
    <Flex flex={1} p={"xl"} align="center">
      <Flex direction="column" align="center" gap="md">
        <IconArrowLeft size={32} color="var(--mantine-color-dimmed)" />
        <Flex direction="column" align="center" gap={4}>
          <Text fw={500} c="dimmed">
            No Parameter Selected
          </Text>
          <Text size="xs" c="dimmed" ta="center" maw={240}>
            Choose a parameter from the tree to view and edit its configuration
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default ParameterEmptyState;
