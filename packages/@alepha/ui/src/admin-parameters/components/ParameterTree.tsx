import { ActionButton, Flex, Text } from "@alepha/ui";
import { ScrollArea, TextInput } from "@mantine/core";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import type { ParameterTreeNode as ParameterTreeNodeData } from "alepha/api/parameters";
import { useCallback, useMemo, useState } from "react";
import ParameterTreeNode from "./ParameterTreeNode.tsx";

/**
 * Filters tree nodes by search query.
 */
const filterTree = (
  nodes: ParameterTreeNodeData[],
  query: string,
): ParameterTreeNodeData[] => {
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
    .filter((node): node is ParameterTreeNodeData => node !== null);
};

/**
 * Collects all folder paths to expand by default.
 */
const collectAllFolderPaths = (nodes: ParameterTreeNodeData[]): Set<string> => {
  const paths = new Set<string>();

  const traverse = (nodeList: ParameterTreeNodeData[]) => {
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

interface Props {
  treeData: ParameterTreeNodeData[];
  selectedConfig: string | null;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}

/**
 * Parameter tree sidebar with search and refresh.
 */
const ParameterTree = (props: Props) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    collectAllFolderPaths(props.treeData),
  );

  // Filter tree by search query
  const filteredTreeData = useMemo(
    () => filterTree(props.treeData, searchQuery),
    [props.treeData, searchQuery],
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
            onClick={props.onRefresh}
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
                <ParameterTreeNode
                  key={node.path}
                  node={node}
                  level={0}
                  selectedConfig={props.selectedConfig}
                  onSelect={props.onSelect}
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
