import { ActionButton, Flex, Text } from "@alepha/mantine";
import { Badge, Loader, ScrollArea, Timeline } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import type { ParameterResponse } from "alepha/api/parameters";
import { useI18n } from "alepha/react/i18n";
import { getStatusColor } from "./types.ts";

interface Props {
  selectedConfig: string | null;
  history: ParameterResponse[];
  loading: boolean;
  onRollback: (version: number) => void;
}

/**
 * Parameter version history timeline panel.
 */
const ParameterHistory = (props: Props) => {
  const { l } = useI18n();

  const renderContent = () => {
    if (props.loading) {
      return (
        <Flex flex={1} justify="center" align="center">
          <Loader size="sm" />
        </Flex>
      );
    }

    if (props.history.length === 0) {
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
          active={props.history.findIndex((h) => h.status === "current")}
          bulletSize={24}
          lineWidth={2}
        >
          {props.history.map((version) => (
            <Timeline.Item
              key={version.id}
              bullet={
                <Text size="xs" fw={500}>
                  {version.version}
                </Text>
              }
              title={
                <Flex gap="xs">
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
                </Flex>
              }
            >
              <Flex direction="column" gap={4} mt={4}>
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
                    onClick={() => props.onRollback(version.version)}
                  >
                    Rollback to this version
                  </ActionButton>
                )}
              </Flex>
            </Timeline.Item>
          ))}
        </Timeline>
      </ScrollArea>
    );
  };

  return (
    <Flex
      w={220}
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
      <Flex direction="column" gap="xs" h="100%" style={{ minHeight: 0 }}>
        <Flex gap="xs">
          <IconHistory size={16} color="var(--mantine-color-dimmed)" />
          <Text size="sm" fw={500}>
            History
          </Text>
        </Flex>
        {renderContent()}
      </Flex>
    </Flex>
  );
};

export default ParameterHistory;
