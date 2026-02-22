import { Flex, JsonViewer, ui } from "@alepha/ui";
import { Badge, Card, Text } from "@mantine/core";

export const DevPanelQueue = ({ queue }: { queue: any }) => {
  return (
    <Flex direction="column" gap="md">
      <div>
        <Text fz="lg" fw={600} mb="xs">
          {queue.name}
        </Text>
        {queue.description && (
          <Text fz="sm" c="dimmed">
            {queue.description}
          </Text>
        )}
      </div>

      <Flex gap="xs">
        <Badge size="xs" variant="light" color="orange">
          Queue
        </Badge>
        {queue.provider && (
          <Badge size="xs" variant="outline" color="gray">
            {queue.provider}
          </Badge>
        )}
      </Flex>

      {queue.schema && (
        <div>
          <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
            Job Schema
          </Text>
          <Card
            padding="sm"
            style={{
              background: ui.colors.surface,
              border: `1px solid ${ui.colors.border}`,
            }}
          >
            <JsonViewer
              data={queue.schema}
              defaultExpandedDepth={2}
              size="xs"
            />
          </Card>
        </div>
      )}
    </Flex>
  );
};
