import { ui } from "@alepha/ui";
import { Badge, Box, Flex, Text } from "@mantine/core";
import { Handle, Position } from "@xyflow/react";
import { getModuleColor } from "./constants.ts";
import type { ProviderNodeData } from "./types.ts";

interface ProviderNodeProps {
  data: ProviderNodeData;
  selected?: boolean;
}

export const ProviderNode = ({ data, selected }: ProviderNodeProps) => {
  const moduleColor = getModuleColor(data.module);
  const isFaded = data.isFaded && !data.isHighlighted;
  const isModule = data.isModule;

  return (
    <Box
      p="xs"
      style={{
        borderRadius: isModule ? 12 : 8,
        border: `2px solid ${selected || data.isSelected ? moduleColor : ui.colors.border}`,
        backgroundColor: ui.colors.surface,
        minWidth: isModule ? 200 : 160,
        opacity: isFaded ? 0.3 : 1,
        transition: "opacity 0.2s, border-color 0.2s",
        boxShadow: data.isHighlighted ? `0 0 10px ${moduleColor}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: moduleColor,
          width: 8,
          height: 8,
          border: "none",
        }}
      />

      <Flex direction="column" gap={4}>
        {isModule ? (
          <>
            <Text size="xs" fw={600} style={{ wordBreak: "break-word" }}>
              {data.label}
            </Text>
            <Text size="xs" c="dimmed">
              {data.providerCount} services
            </Text>
          </>
        ) : (
          <>
            <Text size="xs" fw={600} style={{ wordBreak: "break-word" }}>
              {data.label.split(".").pop()}
            </Text>
            {data.module && (
              <Badge
                size="xs"
                variant="light"
                style={{
                  backgroundColor: `${moduleColor}20`,
                  color: moduleColor,
                }}
              >
                {data.module}
              </Badge>
            )}
          </>
        )}

        <Flex gap={4}>
          {data.dependencies.length > 0 && (
            <Text size="xs" c="dimmed">
              {data.dependencies.length} deps
            </Text>
          )}
          {data.dependents.length > 0 && (
            <Text size="xs" c="dimmed">
              {data.dependents.length} refs
            </Text>
          )}
        </Flex>
      </Flex>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: moduleColor,
          width: 8,
          height: 8,
          border: "none",
        }}
      />
    </Box>
  );
};
