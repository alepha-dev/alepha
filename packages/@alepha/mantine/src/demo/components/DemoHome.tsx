import { Flex, Text } from "@alepha/mantine";
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
    <Flex p={"lg"} col>
      <Text title>Component Showcase</Text>
      <Text c="dimmed">
        Interactive demos and documentation for @alepha/mantine components.
      </Text>
    </Flex>
  );
};

export default DemoHome;
