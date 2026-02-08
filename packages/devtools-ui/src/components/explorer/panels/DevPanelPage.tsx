import { ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import { Badge, Card, Code, Group, Stack, Text } from "@mantine/core";

export const DevPanelPage = ({ page }: { page: any }) => {
  return (
    <Stack gap="md">
      <div>
        <Text fz="lg" fw={600} mb="xs">
          {page.label || page.name}
        </Text>
        {page.path && (
          <Code fz="sm" mb="xs">
            {page.path}
          </Code>
        )}
        {page.description && (
          <Text fz="sm" c="dimmed">
            {page.description}
          </Text>
        )}
      </div>

      <Group gap="xs">
        {page.hasLazy && (
          <Badge size="xs" variant="light" color="blue">
            Lazy
          </Badge>
        )}
        {page.hasParent && (
          <Badge size="xs" variant="light" color="gray">
            Parent: {page.parentName ?? "?"}
          </Badge>
        )}
        {page.hasChildren && (
          <Badge size="xs" variant="light" color="teal">
            Children
          </Badge>
        )}
        {page.hasErrorHandler && (
          <Badge size="xs" variant="light" color="red">
            Error Handler
          </Badge>
        )}
        {page.hasResolve && (
          <Badge size="xs" variant="light" color="violet">
            Loader
          </Badge>
        )}
        {page.client && (
          <Badge size="xs" variant="light" color="orange">
            Client Only
          </Badge>
        )}
        {page.static && (
          <Badge size="xs" variant="light" color="cyan">
            Static
          </Badge>
        )}
      </Group>

      {page.params && (
        <div>
          <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
            Path Parameters
          </Text>
          <Card
            padding="sm"
            style={{
              background: ui.colors.surface,
              border: `1px solid ${ui.colors.border}`,
            }}
          >
            <JsonViewer data={page.params} defaultExpandedDepth={2} size="xs" />
          </Card>
        </div>
      )}

      {page.query && (
        <div>
          <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
            Query Parameters
          </Text>
          <Card
            padding="sm"
            style={{
              background: ui.colors.surface,
              border: `1px solid ${ui.colors.border}`,
            }}
          >
            <JsonViewer data={page.query} defaultExpandedDepth={2} size="xs" />
          </Card>
        </div>
      )}
    </Stack>
  );
};
