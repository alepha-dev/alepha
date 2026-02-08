import { ActionButton, Text } from "@alepha/ui";
import {
  Collapse,
  Flex,
  ScrollArea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconRefresh,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import type { ParameterTreeNode } from "alepha/api/parameters";
import { memo, useCallback, useMemo, useState } from "react";

export interface ParameterTreeProps {
  treeData: ParameterTreeNode[];
  selectedConfig: string | null;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}

/**
 * Filters tree nodes by search query.
 */
const filterTree = (
  nodes: ParameterTreeNode[],
  query: string,
): ParameterTreeNode[] => {
  if (!query.trim()) return nodes;

  const lowerQuery = query.toLowerCase();

  return nodes
    .map((node) => {
      const filteredChildren = filterTree(node.children, query);
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      const pathMatches = node.path.toLowerCase().includes(lowerQuery);

      if (nameMatches || pathMatches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
        };
      }

      return null;
    })
    .filter((node): node is ParameterTreeNode => node !== null);
};

interface TreeNodeProps {
  node: ParameterTreeNode;
  level: number;
  selectedConfig: string | null;
  onSelect: (name: string) => void;
  expandedNodes: Set<string>;
  onToggle: (path: string) => void;
}

/**
 * Memoized tree node to prevent unnecessary re-renders.
 */
const TreeNode = memo(
  ({
    node,
    level,
    selectedConfig,
    onSelect,
    expandedNodes,
    onToggle,
  }: TreeNodeProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.path);
    const isSelected = selectedConfig === node.path;
    const isLeaf = !hasChildren;

    const handleClick = useCallback(() => {
      if (hasChildren) {
        onToggle(node.path);
      } else {
        onSelect(node.path);
      }
    }, [hasChildren, node.path, onToggle, onSelect]);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    return (
      <Flex>
        <UnstyledButton
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          w="100%"
          style={{ display: "block" }}
        >
          <Flex
            gap={6}
            wrap="nowrap"
            p="4px 8px"
            pl={8 + level * 16}
            style={{
              borderRadius: "var(--mantine-radius-sm)",
              backgroundColor:
                isSelected || isHovered
                  ? "var(--mantine-color-default-hover)"
                  : undefined,
            }}
          >
            {hasChildren ? (
              <>
                <Flex
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                  }}
                >
                  {isExpanded ? (
                    <IconChevronDown
                      size={14}
                      color="var(--mantine-color-dimmed)"
                    />
                  ) : (
                    <IconChevronRight
                      size={14}
                      color="var(--mantine-color-dimmed)"
                    />
                  )}
                </Flex>
                {isExpanded ? (
                  <IconFolderOpen
                    size={16}
                    color="var(--mantine-color-dimmed)"
                    style={{ flexShrink: 0 }}
                  />
                ) : (
                  <IconFolder
                    size={16}
                    color="var(--mantine-color-dimmed)"
                    style={{ flexShrink: 0 }}
                  />
                )}
              </>
            ) : (
              <>
                <Flex w={16} />
                <IconSettings
                  size={16}
                  color={
                    isSelected
                      ? "var(--mantine-color-blue-6)"
                      : "var(--mantine-color-dimmed)"
                  }
                  style={{ flexShrink: 0 }}
                />
              </>
            )}
            <Text
              size="sm"
              fw={isSelected ? 600 : 400}
              c={isSelected ? undefined : isLeaf ? undefined : "dimmed"}
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {node.name}
            </Text>
          </Flex>
        </UnstyledButton>

        {hasChildren && (
          <Collapse in={isExpanded}>
            {node.children.map((child: ParameterTreeNode) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                selectedConfig={selectedConfig}
                onSelect={onSelect}
                expandedNodes={expandedNodes}
                onToggle={onToggle}
              />
            ))}
          </Collapse>
        )}
      </Flex>
    );
  },
);

TreeNode.displayName = "TreeNode";

/**
 * Collects all folder paths to expand by default.
 */
const collectAllFolderPaths = (nodes: ParameterTreeNode[]): Set<string> => {
  const paths = new Set<string>();

  const traverse = (nodeList: ParameterTreeNode[]) => {
    for (const node of nodeList) {
      if (node.children.length > 0) {
        paths.add(node.path);
        traverse(node.children);
      }
    }
  };

  traverse(nodes);
  return paths;
};

const ParameterTree = ({
  treeData,
  selectedConfig,
  onSelect,
  onRefresh,
}: ParameterTreeProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    collectAllFolderPaths(treeData),
  );

  // Filter tree by search query
  const filteredTreeData = useMemo(
    () => filterTree(treeData, searchQuery),
    [treeData, searchQuery],
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.currentTarget.value);
    },
    [],
  );

  return (
    <Flex
      w={280}
      h="100%"
      p="sm"
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Flex direction="column" gap="sm" h="100%" style={{ minHeight: 0 }}>
        <Flex justify="space-between" gap="xs">
          <Text size="sm" fw={600}>
            Parameters
          </Text>
          <ActionButton
            variant="subtle"
            size="compact-xs"
            onClick={onRefresh}
            tooltip="Refresh"
          >
            <IconRefresh size={14} />
          </ActionButton>
        </Flex>

        <TextInput
          placeholder="Search..."
          size="xs"
          leftSection={<IconSearch size={14} />}
          value={searchQuery}
          onChange={handleSearchChange}
        />

        <ScrollArea flex={1} offsetScrollbars style={{ minHeight: 0 }}>
          {filteredTreeData.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              {searchQuery ? "No matching parameters" : "No parameters"}
            </Text>
          ) : (
            <Flex direction="column" gap={0} style={{ gap: 1 }}>
              {filteredTreeData.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  level={0}
                  selectedConfig={selectedConfig}
                  onSelect={onSelect}
                  expandedNodes={expandedNodes}
                  onToggle={handleToggle}
                />
              ))}
            </Flex>
          )}
        </ScrollArea>
      </Flex>
    </Flex>
  );
};

export default ParameterTree;
