import { Flex, Text, Title } from "@mantine/core";
import { IconBraces } from "@tabler/icons-react";

const components = [
  {
    name: "JsonViewer",
    description:
      "Interactive JSON viewer with syntax highlighting, expand/collapse, and copy functionality.",
    icon: IconBraces,
    href: "/demo/json-viewer",
  },
];

const DemoHome = () => {
  return (
    <Flex direction="column" gap="xl" p="xl">
      <Flex>
        <Title order={1} mb="xs">
          Component Showcase
        </Title>
        <Text c="dimmed" size="lg">
          Interactive demos and documentation for @alepha/ui components.
        </Text>
      </Flex>
    </Flex>
  );
};

export default DemoHome;
