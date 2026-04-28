import { Flex } from "@alepha/mantine";
import { Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useMemo } from "react";

export interface TreeViewNode {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  children?: TreeViewNode[];
}

export interface TreeViewProps {
  nodes: TreeViewNode[];
  selectedId: string;
  openNodes: Set<string>;
  search?: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  showLeafCount?: boolean;
}

const filterTree = (nodes: TreeViewNode[], search: string): TreeViewNode[] => {
  if (!search) return nodes;
  const term = search.toLowerCase();

  return nodes.reduce<TreeViewNode[]>((acc, node) => {
    if (node.children) {
      const filtered = filterTree(node.children, search);
      if (filtered.length > 0) {
        acc.push({ ...node, children: filtered });
      } else if (node.label.toLowerCase().includes(term)) {
        acc.push(node);
      }
    } else if (node.label.toLowerCase().includes(term)) {
      acc.push(node);
    }
    return acc;
  }, []);
};

const countLeaves = (nodes: TreeViewNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      count += countLeaves(node.children);
    } else {
      count++;
    }
  }
  return count;
};

export const TreeView = ({
  nodes,
  selectedId,
  openNodes,
  search = "",
  onSelect,
  onToggle,
  showLeafCount = true,
}: TreeViewProps) => {
  const filtered = useMemo(() => filterTree(nodes, search), [nodes, search]);

  return (
    <Flex direction="column" gap={2} style={{ minHeight: 0 }}>
      {filtered.map((node) => (
        <TreeViewItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          openNodes={openNodes}
          onSelect={onSelect}
          onToggle={onToggle}
          showLeafCount={showLeafCount}
        />
      ))}
    </Flex>
  );
};

const TreeViewItem = ({
  node,
  depth,
  selectedId,
  openNodes,
  onSelect,
  onToggle,
  showLeafCount,
}: {
  node: TreeViewNode;
  depth: number;
  selectedId: string;
  openNodes: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  showLeafCount: boolean;
}) => {
  const isFolder = !!node.children && node.children.length > 0;
  const isOpen = openNodes.has(node.id);
  const isSelected = selectedId === node.id;
  const leafCount = isFolder ? countLeaves(node.children!) : 0;

  return (
    <>
      <UnstyledButton
        w="100%"
        py={4}
        className="devtools-tree-node"
        data-selected={isSelected || undefined}
        style={{
          borderRadius: 6,
          paddingLeft: 8 + depth * 20,
          paddingRight: 8,
          transition: "background 100ms ease",
        }}
        onClick={() => {
          if (isFolder) {
            onToggle(node.id);
          } else {
            onSelect(node.id);
          }
        }}
      >
        <Flex gap={8} wrap="nowrap">
          {isFolder ? (
            <Flex
              style={{
                width: 14,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              {isOpen ? (
                <IconChevronDown size={14} opacity={0.5} />
              ) : (
                <IconChevronRight size={14} opacity={0.5} />
              )}
            </Flex>
          ) : (
            <Flex
              style={{
                width: 14,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
              }}
            />
          )}
          {node.icon}
          <Text
            fz={12}
            fw={isSelected ? 600 : 400}
            truncate
            style={{ flex: 1 }}
          >
            {node.label}
          </Text>
          {node.badge}
          {isFolder && showLeafCount && leafCount > 0 && (
            <Text fz={10} c="dimmed" style={{ flexShrink: 0 }}>
              {leafCount}
            </Text>
          )}
        </Flex>
      </UnstyledButton>
      {isFolder && isOpen && (
        <Flex direction="column" gap={2} style={{ minHeight: 0 }}>
          {node.children!.map((child) => (
            <TreeViewItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              openNodes={openNodes}
              onSelect={onSelect}
              onToggle={onToggle}
              showLeafCount={showLeafCount}
            />
          ))}
        </Flex>
      )}
    </>
  );
};
