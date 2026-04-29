import {
  Database,
  FileText,
  Folder,
  FolderOpen,
  Layers,
  Radio,
  Route,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useMemo } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";

export interface TreeNode {
  id: string;
  label: string;
  type: "folder" | "action" | "page" | "queue" | "topic" | "cache";
  children?: TreeNode[];
  data?: any;
}

const METHOD_CLASS: Record<string, string> = {
  GET: "text-green-600 bg-green-500/10",
  POST: "text-blue-600 bg-blue-500/10",
  PUT: "text-orange-600 bg-orange-500/10",
  PATCH: "text-yellow-600 bg-yellow-500/10",
  DELETE: "text-red-600 bg-red-500/10",
};

const nodeIcons: Record<string, ComponentType<{ className?: string }>> = {
  page: FileText,
  queue: Layers,
  topic: Radio,
  cache: Database,
};

const nodeIconClass: Record<string, string> = {
  page: "text-blue-500",
  queue: "text-orange-500",
  topic: "text-pink-500",
  cache: "text-cyan-500",
};

const folderIcons: Record<
  string,
  { icon: ComponentType<{ className?: string }>; className: string }
> = {
  actions: { icon: Zap, className: "text-teal-500" },
  pages: { icon: FileText, className: "text-blue-500" },
  queues: { icon: Layers, className: "text-orange-500" },
  topics: { icon: Radio, className: "text-pink-500" },
  caches: { icon: Database, className: "text-cyan-500" },
  routes: { icon: Route, className: "text-violet-500" },
};

interface MethodBadgeProps {
  method: string;
}

const MethodBadge = (props: MethodBadgeProps) => {
  const upper = props.method.toUpperCase();
  const short = upper === "DELETE" ? "DEL" : upper;
  const cls = METHOD_CLASS[upper] ?? "text-muted-foreground bg-muted";
  return (
    <span
      className={`inline-block w-8 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[9px] font-bold leading-none ${cls}`}
    >
      {short}
    </span>
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
      icon = <Icon className={`size-3.5 shrink-0 ${knownFolder.className}`} />;
    } else {
      const isOpen = openNodes.has(node.id);
      const Icon = isOpen ? FolderOpen : Folder;
      icon = <Icon className="size-3.5 text-muted-foreground shrink-0" />;
    }
  } else if (isAction) {
    icon = <MethodBadge method={node.data?.method ?? "GET"} />;
  } else {
    const Icon = nodeIcons[node.type] ?? FileText;
    const cls = nodeIconClass[node.type] ?? "text-muted-foreground";
    icon = <Icon className={`size-3.5 shrink-0 ${cls}`} />;
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

export const ExplorerTree = (props: ExplorerTreeProps) => {
  const treeViewNodes = useMemo(
    () => props.nodes.map((n) => toTreeViewNode(n, props.openNodes)),
    [props.nodes, props.openNodes],
  );

  return (
    <TreeView
      nodes={treeViewNodes}
      selectedId={props.selectedId}
      openNodes={props.openNodes}
      search={props.search}
      onSelect={props.onSelect}
      onToggle={props.onToggle}
    />
  );
};
