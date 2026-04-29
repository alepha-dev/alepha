import { Flex, ui } from "@alepha/mantine";
import { Badge, Card, Text } from "@mantine/core";

const formatTtl = (seconds?: number): string => {
  if (!seconds) return "No TTL";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

export const DevPanelCache = ({ cache }: { cache: any }) => {
  return (
    <Flex direction="column" gap="md">
      <div>
        <Text fz="lg" fw={600} mb="xs">
          {cache.name}
        </Text>
      </div>

      <Flex gap="xs">
        <Badge size="xs" variant="light" color="cyan">
          Cache
        </Badge>
        {cache.provider && (
          <Badge size="xs" variant="outline" color="gray">
            {cache.provider}
          </Badge>
        )}
        {cache.disabled && (
          <Badge size="xs" variant="light" color="red">
            Disabled
          </Badge>
        )}
      </Flex>

      <Card
        padding="sm"
        style={{
          background: ui.colors.surface,
          border: `1px solid ${ui.colors.border}`,
        }}
      >
        <Flex direction="column" gap="xs">
          <Flex justify="space-between">
            <Text fz="xs" c="dimmed">
              TTL
            </Text>
            <Text fz="sm" ff="monospace">
              {formatTtl(cache.ttl)}
            </Text>
          </Flex>
          <Flex justify="space-between">
            <Text fz="xs" c="dimmed">
              Provider
            </Text>
            <Text fz="sm" ff="monospace">
              {cache.provider ?? "default"}
            </Text>
          </Flex>
          <Flex justify="space-between">
            <Text fz="xs" c="dimmed">
              Status
            </Text>
            <Badge size="xs" color={cache.disabled ? "red" : "green"}>
              {cache.disabled ? "Disabled" : "Active"}
            </Badge>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
};
