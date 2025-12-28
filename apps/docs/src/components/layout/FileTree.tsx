import { useRouter, useRouterState } from "@alepha/react";
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { DocNode } from "../../config/docs.ts";

interface FileTreeProps {
  nodes: DocNode[];
  depth: number;
}

export const FileTree = (props: FileTreeProps) => {
  return (
    <div>
      {props.nodes.map((node) => (
        <FileTreeNode key={node.name} node={node} depth={props.depth} />
      ))}
    </div>
  );
};

interface FileTreeNodeProps {
  node: DocNode;
  depth: number;
}

const FileTreeNode = (props: FileTreeNodeProps) => {
  const { node, depth } = props;
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const router = useRouter();
  const state = useRouterState();

  // Check if this node or any of its children is active
  const currentPath = state.url?.pathname || "";
  const isActive = node.href === currentPath;
  const isChildActive =
    hasChildren &&
    node.children?.some(
      (child) =>
        child.href === currentPath ||
        child.children?.some((c) => c.href === currentPath),
    );

  // Auto-expand if child is active
  useEffect(() => {
    if (isChildActive && !expanded) {
      setExpanded(true);
    }
  }, [isChildActive]);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
    if (node.href) {
      router.go(node.href);
    }
  }, [hasChildren, expanded, node.href, router]);

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className="btn-reset file-tree-item w-full"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          paddingLeft: depth * 12 + 8,
          borderRadius: 4,
          fontSize: 13,
          color: isActive
            ? "var(--term-green)"
            : hasChildren
              ? "var(--term-text)"
              : "var(--term-text-dim)",
          background: isActive ? "rgba(34, 197, 94, 0.1)" : "transparent",
          cursor: "pointer",
          transition: "all 0.1s ease",
        }}
      >
        {/* Expand/Collapse Icon */}
        {hasChildren ? (
          expanded ? (
            <IconChevronDown size={14} style={{ flexShrink: 0 }} />
          ) : (
            <IconChevronRight size={14} style={{ flexShrink: 0 }} />
          )
        ) : (
          <span style={{ width: 14, display: "inline-block" }} />
        )}

        {/* File/Folder Icon */}
        {hasChildren ? (
          expanded ? (
            <IconFolderOpen
              size={14}
              style={{ flexShrink: 0, color: "var(--term-amber)" }}
            />
          ) : (
            <IconFolder
              size={14}
              style={{ flexShrink: 0, color: "var(--term-amber)" }}
            />
          )
        ) : (
          <IconFile
            size={14}
            style={{
              flexShrink: 0,
              color: isActive ? "var(--term-green)" : "var(--term-cyan)",
            }}
          />
        )}

        {/* Name */}
        <span className="text-sm truncate">
          {node.name}
          {!hasChildren && ".md"}
        </span>
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <FileTree nodes={node.children || []} depth={depth + 1} />
      )}
    </div>
  );
};

export default FileTree;
