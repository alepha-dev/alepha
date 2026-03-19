import { ActionButton, Flex, ui } from "@alepha/ui";
import { Badge, Divider, Paper, ScrollArea, Text } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconBox,
  IconX,
} from "@tabler/icons-react";
import { getModuleColor } from "./constants.ts";
import type { ProviderNodeData } from "./types.ts";

interface NodeDetailsProps {
  node: { id: string; data: ProviderNodeData } | null;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

export const NodeDetails = ({
  node,
  onClose,
  onNodeClick,
}: NodeDetailsProps) => {
  if (!node) return null;

  const { data } = node;
  const moduleColor = getModuleColor(data.module);
  const isModule = data.isModule;

  return (
    <Paper
      p="md"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 280,
        backgroundColor: ui.colors.elevated,
        border: `1px solid ${ui.colors.border}`,
        borderRadius: 8,
        zIndex: 10,
      }}
    >
      <Flex justify="space-between" align="start" mb="sm">
        <Flex style={{ flex: 1 }}>
          <Text size="sm" fw={600} style={{ wordBreak: "break-word" }}>
            {data.label}
          </Text>
          {!isModule && data.module && (
            <Badge
              size="xs"
              variant="light"
              mt={4}
              style={{
                backgroundColor: `${moduleColor}20`,
                color: moduleColor,
              }}
            >
              {data.module}
            </Badge>
          )}
          {isModule && data.providerCount !== undefined && (
            <Text size="xs" c="dimmed" mt={4}>
              {data.providerCount} services
            </Text>
          )}
        </Flex>
        <ActionButton
          size="sm"
          variant="subtle"
          onClick={onClose}
          icon={<IconX size={14} />}
        />
      </Flex>

      {!isModule && data.aliases && data.aliases.length > 0 && (
        <>
          <Divider my="xs" />
          <Text size="xs" c="dimmed" mb={4}>
            Aliases
          </Text>
          <Flex gap={4} wrap="wrap">
            {data.aliases.map((alias) => (
              <Badge key={alias} size="xs" variant="outline">
                {alias}
              </Badge>
            ))}
          </Flex>
        </>
      )}

      {isModule && data.providers && data.providers.length > 0 && (
        <>
          <Divider my="xs" />
          <Flex align="center" gap={4} mb={4}>
            <IconBox size={12} opacity={0.5} />
            <Text size="xs" c="dimmed">
              Services ({data.providers.length})
            </Text>
          </Flex>
          <ScrollArea h={100}>
            <Flex direction="column" gap={2}>
              {data.providers.map((provider) => (
                <Text key={provider} size="xs">
                  {provider.split(".").pop()}
                </Text>
              ))}
            </Flex>
          </ScrollArea>
        </>
      )}

      <Divider my="xs" />

      <ScrollArea h={isModule ? 120 : 200}>
        <Flex direction="column" gap="xs">
          {data.dependencies.length > 0 && (
            <Flex>
              <Flex align="center" gap={4} mb={4}>
                <IconArrowDown size={12} opacity={0.5} />
                <Text size="xs" c="dimmed">
                  {isModule ? "Depends on" : "Dependencies"} (
                  {data.dependencies.length})
                </Text>
              </Flex>
              <Flex direction="column" gap={2}>
                {data.dependencies.map((dep) => (
                  <Text
                    key={dep}
                    size="xs"
                    style={{ cursor: "pointer" }}
                    c="blue"
                    onClick={() => onNodeClick(dep)}
                  >
                    {dep}
                  </Text>
                ))}
              </Flex>
            </Flex>
          )}

          {data.dependents.length > 0 && (
            <Flex>
              <Flex align="center" gap={4} mb={4}>
                <IconArrowUp size={12} opacity={0.5} />
                <Text size="xs" c="dimmed">
                  Used by ({data.dependents.length})
                </Text>
              </Flex>
              <Flex direction="column" gap={2}>
                {data.dependents.map((dep) => (
                  <Text
                    key={dep}
                    size="xs"
                    style={{ cursor: "pointer" }}
                    c="blue"
                    onClick={() => onNodeClick(dep)}
                  >
                    {dep}
                  </Text>
                ))}
              </Flex>
            </Flex>
          )}

          {data.dependencies.length === 0 && data.dependents.length === 0 && (
            <Text size="xs" c="dimmed">
              No dependencies
            </Text>
          )}
        </Flex>
      </ScrollArea>
    </Paper>
  );
};
