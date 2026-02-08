import { ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import { Badge, Card, Group, Stack, Text } from "@mantine/core";

export const DevPanelTopic = ({ topic }: { topic: any }) => {
  return (
    <Stack gap="md">
      <div>
        <Text fz="lg" fw={600} mb="xs">
          {topic.name}
        </Text>
        {topic.description && (
          <Text fz="sm" c="dimmed">
            {topic.description}
          </Text>
        )}
      </div>

      <Group gap="xs">
        <Badge size="xs" variant="light" color="pink">
          Topic
        </Badge>
        {topic.provider && (
          <Badge size="xs" variant="outline" color="gray">
            {topic.provider}
          </Badge>
        )}
        {topic.subscribers > 0 && (
          <Badge size="xs" variant="light" color="gray">
            {topic.subscribers} subscriber{topic.subscribers !== 1 ? "s" : ""}
          </Badge>
        )}
      </Group>

      {topic.schema && (
        <div>
          <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
            Message Schema
          </Text>
          <Card
            padding="sm"
            style={{
              background: ui.colors.surface,
              border: `1px solid ${ui.colors.border}`,
            }}
          >
            <JsonViewer
              data={topic.schema}
              defaultExpandedDepth={2}
              size="xs"
            />
          </Card>
        </div>
      )}
    </Stack>
  );
};
