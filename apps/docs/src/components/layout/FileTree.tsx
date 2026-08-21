import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useRouter, useRouterState } from "alepha/react/router";
import { type CSSProperties, useCallback, useState } from "react";

import type { DocNode } from "../../config/docs.ts";

import styles from "./FileTree.module.css";

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
    <div
      className={styles.container}
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? "Documentation files" : undefined}
    >
      {/* Vertical indent guide */}
      {depth > 0 && (
        <div
          className={styles.indentGuide}
          style={{ "--guide-left": `${guideLeft}px` } as CSSProperties}
          aria-hidden="true"
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
  const [appliedDefault, setAppliedDefault] = useState(defaultExpanded);
  if (defaultExpanded !== appliedDefault) {
    setAppliedDefault(defaultExpanded);
    if (defaultExpanded !== undefined) {
      setExpanded(defaultExpanded);
    }
  }

  // Auto-expand when a child becomes active (but don't collapse)
  // Skip auto-expand if user explicitly collapsed all (defaultExpanded === false)
  const [appliedActive, setAppliedActive] = useState(containsActive);
  if (containsActive !== appliedActive) {
    setAppliedActive(containsActive);
    if (containsActive && !expanded && defaultExpanded !== false) {
      setExpanded(true);
    }
  }

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
    if (node.href) {
      // Close mobile sidebar when navigating
      window.dispatchEvent(new CustomEvent("close-mobile-sidebar"));
      if (node.asset) {
        window.location.href = node.href;
      } else {
        void router.push(node.href);
      }
    }
  }, [hasChildren, expanded, node.href, node.asset, router]);

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

  // Build class names
  const rowClasses = [
    styles.row,
    hasChildren && styles.rowFolder,
    isActive && styles.rowActive,
  ]
    .filter(Boolean)
    .join(" ");

  const itemLabel = hasChildren
    ? `${node.name} folder${expanded ? ", expanded" : ", collapsed"}`
    : `${node.name}.${node.asset || "md"}`;

  return (
    <div
      className="relative"
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <Element
        href={node.href}
        type={node.href ? undefined : "button"}
        onClick={handleClickWithEvent}
        className={rowClasses}
        style={{ "--indent": `${rowPaddingLeft}px` } as React.CSSProperties}
        aria-current={isActive ? "page" : undefined}
        aria-label={itemLabel}
      >
        {/* Active indicator bar */}
        {isActive && (
          <div className={styles.activeIndicator} aria-hidden="true" />
        )}

        {/* Chevron column */}
        <span className={styles.iconCol} aria-hidden="true">
          {hasChildren &&
            (expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            ))}
        </span>

        {/* Icon column */}
        <span
          className={`${styles.iconCol} ${hasChildren ? styles.iconFolder : styles.iconFile}`}
          aria-hidden="true"
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
        <span className={styles.name} aria-hidden="true">
          {node.name.toLowerCase()}
          {!hasChildren && (
            <span className={styles.extension}>.{node.asset || "md"}</span>
          )}
        </span>

        {/* Hover arrow indicator for files */}
        {!hasChildren && (
          <span className={styles.hoverArrow} aria-hidden="true">
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
