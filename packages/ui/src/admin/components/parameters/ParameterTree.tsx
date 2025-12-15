import { ActionButton, Text } from "@alepha/ui";
import {
  Box,
  Card,
  Group,
  ScrollArea,
  Stack,
  Tooltip,
  Tree,
  type TreeNodeData,
  useTree,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import type { ConfigTreeNode } from "alepha/api/parameters";
import { type HTMLAttributes, useMemo } from "react";

export interface ParameterTreeProps {
  treeData: ConfigTreeNode[];
  selectedConfig: string | null;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}

const ParameterTree = ({
  treeData,
  selectedConfig,
  onSelect,
  onRefresh,
}: ParameterTreeProps) => {
  const tree = useTree({
    initialExpandedState: {},
  });

  const mantineTreeData = useMemo((): TreeNodeData[] => {
    const convert = (nodes: ConfigTreeNode[]): TreeNodeData[] => {
      return nodes.map((node) => ({
        value: node.path,
        label: node.name,
        children: node.children.length > 0 ? convert(node.children) : undefined,
      }));
    };
    return convert(treeData);
  }, [treeData]);

  const renderNode = ({
    node,
    expanded,
    hasChildren,
    elementProps,
  }: {
    node: TreeNodeData;
    expanded: boolean;
    hasChildren: boolean;
    elementProps: HTMLAttributes<HTMLDivElement>;
  }) => {
    const isLeaf = !hasChildren;
    const isSelected = selectedConfig === node.value;

    return (
      <Group
        gap="xs"
        wrap="nowrap"
        {...elementProps}
        onClick={(e) => {
          elementProps.onClick?.(e);
          if (isLeaf) {
            onSelect(node.value);
          }
        }}
        style={{
          ...elementProps.style,
          cursor: isLeaf ? "pointer" : "default",
          backgroundColor: isSelected
            ? "var(--mantine-color-blue-light)"
            : undefined,
          borderRadius: "var(--mantine-radius-sm)",
          paddingTop: 4,
          paddingBottom: 4,
          paddingRight: 8,
        }}
      >
        {hasChildren ? (
          <>
            {expanded ? (
              <IconChevronDown size={14} color="var(--mantine-color-dimmed)" />
            ) : (
              <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
            )}
            {expanded ? (
              <IconFolderOpen size={16} color="var(--mantine-color-blue-6)" />
            ) : (
              <IconFolder size={16} color="var(--mantine-color-blue-6)" />
            )}
          </>
        ) : (
          <>
            <Box w={14} />
            <IconSettings size={16} color="var(--mantine-color-gray-6)" />
          </>
        )}
        <Text size="sm" fw={isSelected ? 500 : 400}>
          {node.label}
        </Text>
      </Group>
    );
  };

  return (
    <Card withBorder w={280} h="100%" style={{ flexShrink: 0 }}>
      <Stack gap="xs" h="100%">
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Parameters
          </Text>
          <Tooltip label="Refresh">
            <ActionButton
              variant="subtle"
              size="compact-xs"
              onClick={onRefresh}
            >
              <IconRefresh size={14} />
            </ActionButton>
          </Tooltip>
        </Group>
        <ScrollArea flex={1} offsetScrollbars>
          <Tree
            data={mantineTreeData}
            tree={tree}
            levelOffset={20}
            expandOnClick
            renderNode={renderNode}
          />
        </ScrollArea>
      </Stack>
    </Card>
  );
};

export default ParameterTree;
