import { Flex, Text } from "@alepha/ui";
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
        Interactive demos and documentation for @alepha/ui components.
      </Text>
    </Flex>
  );
};

export default DemoHome;
