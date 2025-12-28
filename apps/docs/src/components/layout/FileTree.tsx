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

// Grid constants for perfect alignment
const INDENT = 20; // pixels per depth level
const BASE = 8; // base left padding
const COL = 16; // column width for chevron and icon

interface FileTreeProps {
  nodes: DocNode[];
  depth: number;
  defaultExpanded?: boolean;
}

export const FileTree = (props: FileTreeProps) => {
  const { depth, defaultExpanded } = props;

  // Vertical guide position: center of chevron column at (depth - 1)
  const guideLeft = BASE + (depth - 1) * INDENT + COL / 2;

  return (
    <div className="relative" style={{ overflow: "auto", flex: 1 }}>
      {/* Vertical indent guide */}
      {depth > 0 && (
        <div
          style={{
            position: "absolute",
            left: guideLeft,
            top: 0,
            bottom: 0,
            width: 1,
            background:
              "linear-gradient(to bottom, transparent 0%, var(--color-border) 10%, var(--color-border) 90%, transparent 100%)",
            opacity: 0.4,
          }}
        />
      )}
      {props.nodes.map((node) => (
        <FileTreeNode
          key={node.name}
          node={node}
          depth={depth}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  );
};

interface FileTreeNodeProps {
  node: DocNode;
  depth: number;
  defaultExpanded?: boolean;
}

// Recursively check if any descendant matches the current path
const hasActiveDescendant = (node: DocNode, currentPath: string): boolean => {
  if (node.href === currentPath) return true;
  if (node.children) {
    return node.children.some((child) =>
      hasActiveDescendant(child, currentPath),
    );
  }
  return false;
};

const FileTreeNode = (props: FileTreeNodeProps) => {
  const { node, depth, defaultExpanded } = props;
  const [isHovered, setIsHovered] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const router = useRouter();
  const state = useRouterState();

  // Check if this node or any of its descendants is active
  const currentPath = state.url?.pathname || "";
  const isActive = node.href === currentPath;
  const containsActive = hasChildren && hasActiveDescendant(node, currentPath);

  // Expand state: controlled by defaultExpanded (from expand all button) or if contains active route on init
  const [expanded, setExpanded] = useState(defaultExpanded ?? containsActive);

  // Only respond to defaultExpanded changes (from expand/collapse all buttons)
  // Don't auto-collapse when navigating between files
  useEffect(() => {
    if (defaultExpanded !== undefined) {
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded]);

  // Auto-expand when a child becomes active (but don't collapse)
  useEffect(() => {
    if (containsActive && !expanded) {
      setExpanded(true);
    }
  }, [containsActive]);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
    if (node.href) {
      if (node.asset) {
        window.location.href = node.href;
      } else {
        router.go(node.href);
      }
    }
  }, [hasChildren, expanded, node.href, node.asset, router]);

  // Determine colors based on state
  const getTextColor = () => {
    if (isActive) return "var(--color-text)";
    if (isHovered) return "var(--color-text)";
    if (hasChildren) return "var(--color-text)";
    return "var(--color-text-muted)";
  };

  const getBackground = () => {
    if (isActive) return "rgba(255, 255, 255, 0.08)";
    if (isHovered) return "rgba(255, 255, 255, 0.04)";
    return "transparent";
  };

  const getIconColor = () => {
    if (isActive) return "var(--color-cyan)";
    if (isHovered) return "var(--color-cyan)";
    return "var(--color-cyan)";
  };

  // Row padding: BASE + depth * INDENT
  const rowPaddingLeft = BASE + depth * INDENT;

  // Use <a> for items with href (files), <button> for folders
  const Element = node.href ? "a" : "button";

  const handleClickWithEvent = (e: React.MouseEvent) => {
    // For links, only intercept normal clicks (not shift/ctrl/cmd clicks)
    if (node.href && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleClick();
    } else if (!node.href) {
      // For folders, always handle click
      handleClick();
    }
  };

  return (
    <div className="relative">
      <Element
        href={node.href}
        type={node.href ? undefined : "button"}
        onClick={handleClickWithEvent}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="btn-reset file-tree-item w-full"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "5px 8px",
          paddingLeft: rowPaddingLeft,
          borderRadius: 4,
          fontSize: 13,
          color: getTextColor(),
          background: getBackground(),
          cursor: "pointer",
          transition: "all 0.15s ease",
          position: "relative",
          textDecoration: "none",
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        {/* Active indicator bar */}
        {isActive && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 4,
              bottom: 4,
              width: 2,
              background: "var(--color-accent)",
              borderRadius: 1,
            }}
          />
        )}

        {/* Chevron column - fixed width */}
        <span
          style={{
            width: COL,
            height: COL,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasChildren &&
            (expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            ))}
        </span>

        {/* Icon column - fixed width */}
        <span
          style={{
            width: COL,
            height: COL,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: hasChildren ? "var(--color-amber)" : getIconColor(),
            transition: "color 0.15s ease",
          }}
        >
          {hasChildren ? (
            expanded ? (
              <IconFolderOpen size={14} />
            ) : (
              <IconFolder size={14} />
            )
          ) : (
            <IconFile size={14} />
          )}
        </span>

        {/* Name */}
        <span
          className="truncate"
          style={{
            fontSize: 13,
            marginLeft: 2,
            transition: "color 0.15s ease",
          }}
        >
          {node.name.toLowerCase()}
          {!hasChildren && (
            <span style={{ opacity: 0.5 }}>.{node.asset || "md"}</span>
          )}
        </span>

        {/* Hover arrow indicator for files */}
        {!hasChildren && isHovered && (
          <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 10 }}>
            →
          </span>
        )}
      </Element>

      {/* Children */}
      {hasChildren && expanded && (
        <FileTree
          nodes={node.children || []}
          depth={depth + 1}
          defaultExpanded={defaultExpanded}
        />
      )}
    </div>
  );
};

export default FileTree;
