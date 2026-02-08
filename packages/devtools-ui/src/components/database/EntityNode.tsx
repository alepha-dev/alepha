import { Flex, ui } from "@alepha/ui";
import { Badge, Text } from "@mantine/core";
import { IconKey, IconLink } from "@tabler/icons-react";
import { Handle, type NodeProps, Position } from "@xyflow/react";

export const EntityNode = ({ data }: NodeProps) => {
  const entity = data as any;

  return (
    <div
      style={{
        background: ui.colors.surface,
        border: `1px solid ${ui.colors.border}`,
        borderRadius: 8,
        minWidth: 240,
        overflow: "hidden",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "var(--mantine-color-blue-6)" }}
      />

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${ui.colors.border}`,
          background: ui.colors.elevated,
        }}
      >
        <Flex gap="xs">
          <Text fz="sm" fw={700}>
            {entity.name}
          </Text>
          <Badge size="xs" variant="light" color="gray">
            {entity.provider}
          </Badge>
        </Flex>
      </div>

      {/* Columns */}
      <Flex direction="column" gap={0} p={0}>
        {(entity.columns ?? []).map((col: any) => (
          <Flex
            key={col.name}
            gap="xs"
            px="sm"
            py={4}
            style={{ borderBottom: `1px solid ${ui.colors.border}20` }}
            wrap="nowrap"
          >
            {col.primaryKey && (
              <IconKey size={10} color="var(--mantine-color-yellow-6)" />
            )}
            {col.ref && (
              <IconLink size={10} color="var(--mantine-color-blue-6)" />
            )}
            {!col.primaryKey && !col.ref && <span style={{ width: 10 }} />}
            <Text fz={11} ff="monospace" style={{ flex: 1 }}>
              {col.name}
            </Text>
            <Text fz={10} c="dimmed" ff="monospace">
              {col.type}
            </Text>
            {col.nullable && (
              <Text fz={9} c="dimmed">
                ?
              </Text>
            )}
          </Flex>
        ))}
      </Flex>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "var(--mantine-color-blue-6)" }}
      />
    </div>
  );
};
