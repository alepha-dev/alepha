import { Alert, Flex, Text } from "@mantine/core";
import { IconInfoCircle, IconTools } from "@tabler/icons-react";

export const DevDashboard = () => {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      flex={1}
      w="100%"
      gap="xl"
    >
      <Flex direction="column" align="center" gap={4} mb="md">
        <Flex align="center" gap="sm">
          <IconTools size={40} stroke={1.5} opacity={0.8} />
          <Text size="2rem" fw={300} style={{ letterSpacing: "-0.02em" }}>
            Alepha DevTools
          </Text>
        </Flex>
      </Flex>

      <Alert
        icon={<IconInfoCircle />}
        title="Work In Progress"
        color="blue"
        variant="light"
        maw={500}
      >
        DevTools is still in active development. New features and improvements
        are being added regularly. Use the navigation to explore available
        tools.
      </Alert>
    </Flex>
  );
};

export default DevDashboard;
