import { Box, Stack, Text, Title } from "@mantine/core";
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
    <Stack gap="xl" p="xl">
      <Box>
        <Title order={1} mb="xs">
          Component Showcase
        </Title>
        <Text c="dimmed" size="lg">
          Interactive demos and documentation for @alepha/ui components.
        </Text>
      </Box>
    </Stack>
  );
};

export default DemoHome;
