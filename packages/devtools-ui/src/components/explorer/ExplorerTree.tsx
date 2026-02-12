import { Text } from "@mantine/core";
import {
  IconApi,
  IconBroadcast,
  IconDatabase,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconRoute,
  IconStack2,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";

export interface TreeNode {
  id: string;
  label: string;
  type: "folder" | "action" | "page" | "queue" | "topic" | "cache";
  children?: TreeNode[];
  data?: any;
}

// Method badge: use Mantine's light variant colors (scheme-aware)
const METHOD_COLORS: Record<string, { color: string; bg: string }> = {
  GET: {
    color: "var(--mantine-color-green-text)",
    bg: "var(--mantine-color-green-light)",
  },
  POST: {
    color: "var(--mantine-color-blue-text)",
    bg: "var(--mantine-color-blue-light)",
  },
  PUT: {
    color: "var(--mantine-color-orange-text)",
    bg: "var(--mantine-color-orange-light)",
  },
  PATCH: {
    color: "var(--mantine-color-yellow-text)",
    bg: "var(--mantine-color-yellow-light)",
  },
  DELETE: {
    color: "var(--mantine-color-red-text)",
    bg: "var(--mantine-color-red-light)",
  },
};

const nodeIcons: Record<string, any> = {
  page: IconFileText,
  queue: IconStack2,
  topic: IconBroadcast,
  cache: IconDatabase,
};

// Use Mantine text colors: these adapt to light/dark scheme
const nodeColors: Record<string, string> = {
  page: "var(--mantine-color-blue-text)",
  queue: "var(--mantine-color-orange-text)",
  topic: "var(--mantine-color-pink-text)",
  cache: "var(--mantine-color-cyan-text)",
};

const folderIcons: Record<string, { icon: any; color: string }> = {
  actions: { icon: IconApi, color: "var(--mantine-color-teal-text)" },
  pages: { icon: IconFileText, color: "var(--mantine-color-blue-text)" },
  queues: { icon: IconStack2, color: "var(--mantine-color-orange-text)" },
  topics: { icon: IconBroadcast, color: "var(--mantine-color-pink-text)" },
  caches: { icon: IconDatabase, color: "var(--mantine-color-cyan-text)" },
  routes: { icon: IconRoute, color: "var(--mantine-color-violet-text)" },
};

const MethodBadge = ({ method }: { method: string }) => {
  const upper = method.toUpperCase();
  const short = upper === "DELETE" ? "DEL" : upper;
  const colors = METHOD_COLORS[upper] ?? {
    color: "var(--mantine-color-dimmed)",
    bg: "var(--mantine-color-default-hover)",
  };
  return (
    <Text
      component="span"
      fz={9}
      fw={700}
      ff="monospace"
      lh={1}
      style={{
        paddingTop: 5,
        color: colors.color,
        background: colors.bg,
        padding: "2px 4px",
        borderRadius: 3,
        flexShrink: 0,
        letterSpacing: 0.3,
        width: 32,
        textAlign: "center",
        display: "inline-block",
      }}
    >
      {short}
    </Text>
  );
};

const toTreeViewNode = (
  node: TreeNode,
  openNodes: Set<string>,
): TreeViewNode => {
  const isFolder = node.type === "folder";
  const isAction = node.type === "action";

  let icon: React.ReactNode;

  if (isFolder) {
    const knownFolder = folderIcons[node.id];
    if (knownFolder) {
      const Icon = knownFolder.icon;
      icon = (
        <Icon size={15} color={knownFolder.color} style={{ flexShrink: 0 }} />
      );
    } else {
      const isOpen = openNodes.has(node.id);
      const Icon = isOpen ? IconFolderOpen : IconFolder;
      icon = (
        <Icon
          size={15}
          color="var(--mantine-color-dimmed)"
          style={{ flexShrink: 0 }}
        />
      );
    }
  } else if (isAction) {
    icon = <MethodBadge method={node.data?.method ?? "GET"} />;
  } else {
    const Icon = nodeIcons[node.type] ?? IconFileText;
    const color = nodeColors[node.type] ?? "var(--mantine-color-dimmed)";
    icon = <Icon size={15} color={color} style={{ flexShrink: 0 }} />;
  }

  return {
    id: node.id,
    label: node.label,
    icon,
    children: node.children?.map((child) => toTreeViewNode(child, openNodes)),
  };
};

interface ExplorerTreeProps {
  nodes: TreeNode[];
  selectedId: string;
  openNodes: Set<string>;
  search: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

export const ExplorerTree = ({
  nodes,
  selectedId,
  openNodes,
  search,
  onSelect,
  onToggle,
}: ExplorerTreeProps) => {
  const treeViewNodes = useMemo(
    () => nodes.map((n) => toTreeViewNode(n, openNodes)),
    [nodes, openNodes],
  );

  return (
    <TreeView
      nodes={treeViewNodes}
      selectedId={selectedId}
      openNodes={openNodes}
      search={search}
      onSelect={onSelect}
      onToggle={onToggle}
    />
  );
};
