import { Box, Code, Text } from "@mantine/core";

interface SchemaViewerProps {
  schema: unknown;
  label: string;
}

export const SchemaViewer = ({ schema, label }: SchemaViewerProps) => {
  if (!schema) return null;

  return (
    <Box>
      <Text size="xs" fw={500} c="dimmed" mb={4}>
        {label}
      </Text>
      <Code block style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>
        {JSON.stringify(schema, null, 2)}
      </Code>
    </Box>
  );
};
