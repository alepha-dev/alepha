import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Timeline,
} from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import type { Parameter } from "alepha/api/parameters";
import { useI18n } from "alepha/react/i18n";
import { getStatusColor } from "./types.ts";

export interface ParameterHistoryProps {
  selectedConfig: string | null;
  history: Parameter[];
  loading: boolean;
  onRollback: (version: number) => void;
}

const ParameterHistory = ({
  history,
  loading,
  onRollback,
}: ParameterHistoryProps) => {
  const { l } = useI18n();

  const renderContent = () => {
    if (loading) {
      return (
        <Flex flex={1} justify="center" align="center">
          <Loader size="sm" />
        </Flex>
      );
    }

    if (history.length === 0) {
      return (
        <Flex flex={1} justify="center" align="center">
          <Text c="dimmed" size="xs">
            Empty
          </Text>
        </Flex>
      );
    }

    return (
      <ScrollArea flex={1} offsetScrollbars>
        <Timeline
          active={history.findIndex((h) => h.status === "current")}
          bulletSize={24}
          lineWidth={2}
        >
          {history.map((version) => (
            <Timeline.Item
              key={version.id}
              bullet={
                <Text size="xs" fw={500}>
                  {version.version}
                </Text>
              }
              title={
                <Group gap="xs">
                  <Text size="xs" fw={500}>
                    Version {version.version}
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color={getStatusColor(version.status)}
                  >
                    {version.status}
                  </Badge>
                </Group>
              }
            >
              <Stack gap={4} mt={4}>
                <Text size="xs" c="dimmed">
                  {l(version.createdAt, { date: "fromNow" })}
                </Text>
                {version.changeDescription && (
                  <Text size="xs" lineClamp={2}>
                    {version.changeDescription}
                  </Text>
                )}
                {version.creatorName && (
                  <Text size="xs" c="dimmed">
                    by {version.creatorName}
                  </Text>
                )}
                {version.migrationLog && (
                  <Badge size="xs" variant="outline" color="orange">
                    Schema Changed
                  </Badge>
                )}
                {version.status === "expired" && (
                  <ActionButton
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => onRollback(version.version)}
                  >
                    Rollback to this version
                  </ActionButton>
                )}
              </Stack>
            </Timeline.Item>
          ))}
        </Timeline>
      </ScrollArea>
    );
  };

  return (
    <Box
      w={160}
      h="100%"
      p="xs"
      style={{
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
        <Group gap="xs">
          <IconHistory size={16} color="var(--mantine-color-dimmed)" />
          <Text size="sm" fw={500}>
            History
          </Text>
        </Group>
        {renderContent()}
      </Stack>
    </Box>
  );
};

export default ParameterHistory;
