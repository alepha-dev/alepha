import { Flex, Text } from "@alepha/ui";

const Dashboard = () => {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      mih="60vh"
      gap="md"
    >
      <Text size="xl" fw={600}>
        Roadmap Admin
      </Text>
      <Text c="dimmed">Welcome to the admin panel.</Text>
    </Flex>
  );
};

export default Dashboard;
