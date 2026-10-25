import { ChevronDown, ChevronRight } from "lucide-react";
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

export const TreeView = (props: TreeViewProps) => {
  const showLeafCount = props.showLeafCount ?? true;
  const filtered = useMemo(
    () => filterTree(props.nodes, props.search ?? ""),
    [props.nodes, props.search],
  );

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      {filtered.map((node) => (
        <TreeViewItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={props.selectedId}
          openNodes={props.openNodes}
          onSelect={props.onSelect}
          onToggle={props.onToggle}
          showLeafCount={showLeafCount}
        />
      ))}
    </div>
  );
};

interface TreeViewItemProps {
  node: TreeViewNode;
  depth: number;
  selectedId: string;
  openNodes: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  showLeafCount: boolean;
}

const TreeViewItem = (props: TreeViewItemProps) => {
  const {
    node,
    depth,
    selectedId,
    openNodes,
    onSelect,
    onToggle,
    showLeafCount,
  } = props;
  const isFolder = !!node.children && node.children.length > 0;
  const isOpen = openNodes.has(node.id);
  const isSelected = selectedId === node.id;
  const leafCount = isFolder ? countLeaves(node.children!) : 0;

  return (
    <>
      <button
        type="button"
        data-selected={isSelected || undefined}
        className="hover:bg-muted/50 data-[selected=true]:bg-muted flex w-full items-center rounded-md py-1 pr-2 text-left transition-colors"
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={() => {
          if (isFolder) {
            onToggle(node.id);
          } else {
            onSelect(node.id);
          }
        }}
      >
        <div className="flex w-full flex-nowrap items-center gap-2">
          <div className="flex w-3.5 shrink-0 items-center">
            {isFolder ? (
              isOpen ? (
                <ChevronDown className="size-3.5 opacity-50" />
              ) : (
                <ChevronRight className="size-3.5 opacity-50" />
              )
            ) : null}
          </div>
          {node.icon}
          <span
            className={`flex-1 truncate text-xs ${isSelected ? "font-semibold" : "font-normal"}`}
          >
            {node.label}
          </span>
          {node.badge}
          {isFolder && showLeafCount && leafCount > 0 && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {leafCount}
            </span>
          )}
        </div>
      </button>
      {isFolder && isOpen && (
        <div className="flex min-h-0 flex-col gap-0.5">
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
        </div>
      )}
    </>
  );
};
