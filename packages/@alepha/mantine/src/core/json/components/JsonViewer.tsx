import {
  getTreeExpandedState,
  type MantineSize,
  Text,
  Tree,
  useTree,
} from "@mantine/core";
import { type ReactNode, useCallback, useMemo } from "react";
import { JsonViewerRowNode } from "./JsonViewerRowNode.tsx";
import {
  getValueType,
  type JsonTreeNode,
  SIZE_CONFIG,
  STYLES,
} from "./JsonViewerShared.ts";

// =============================================================================
// PROPS
// =============================================================================

export interface JsonViewerProps {
  data: any;
  /**
   * Depth level to expand by default (0 = collapsed, Infinity = all expanded)
   */
  defaultExpandedDepth?: number;
  /**
   * Maximum nesting depth to render
   */
  maxDepth?: number;
  /**
   * Size variant
   */
  size?: MantineSize;
  /**
   * Whether to show quotes around keys and strings
   */
  showQuotes?: boolean;
  /**
   * Show copy button on row hover
   */
  showCopyButton?: boolean;
  /**
   * Custom value formatter. Return formatted string or undefined to use default.
   */
  formatValue?: (
    key: string | undefined,
    value: any,
    path: string[],
  ) => string | number | undefined;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const JsonViewer = (props: JsonViewerProps) => {
  const {
    data,
    defaultExpandedDepth = 2,
    maxDepth = 10,
    size = "sm",
    showQuotes = false,
    showCopyButton = true,
    formatValue,
  } = props;

  const config = SIZE_CONFIG[size] || SIZE_CONFIG.sm;

  // Build tree data from JSON with root wrapper
  const treeData = useMemo(() => {
    const type = getValueType(data);

    // For objects and arrays, create a root node wrapper
    if (type === "object" || type === "array") {
      const entries =
        type === "array"
          ? (data as any[]).map((v, i) => [String(i), v] as const)
          : Object.entries(data);
      const children = entries
        .map(([k, v]) => buildTreeNodes(v, [], k, type === "array", maxDepth))
        .filter((n): n is JsonTreeNode => n !== null);

      const rootNode: JsonTreeNode = {
        value: "root",
        label: "",
        nodeValue: data,
        nodeKey: undefined,
        path: [],
        isArrayItem: false,
        isRoot: true,
        children: children.length > 0 ? children : undefined,
      };
      return [rootNode];
    }

    // For primitives, just show the value directly
    const node = buildTreeNodes(data, [], undefined, false, maxDepth);
    return node ? [node] : [];
  }, [data, maxDepth]);

  // Compute initial expanded state (root is always expanded by default unless depth is 0)
  const initialExpandedState = useMemo(() => {
    if (defaultExpandedDepth === 0) return {};
    if (defaultExpandedDepth === Infinity) {
      return getTreeExpandedState(treeData, "*");
    }
    // Add 1 to depth to account for root node
    const ids = getExpandedIds(treeData, defaultExpandedDepth + 1);
    return getTreeExpandedState(treeData, ids);
  }, [treeData, defaultExpandedDepth]);

  const tree = useTree({ initialExpandedState });

  // Render value based on type
  const renderValue = useCallback(
    (val: any, key: string | undefined, path: string[]): ReactNode => {
      const custom = formatValue?.(key, val, path);
      if (custom !== undefined) {
        return (
          <Text
            component="span"
            size={size}
            style={STYLES.string}
            className="alepha-json-viewer-value"
            title={String(val)}
          >
            {custom}
          </Text>
        );
      }

      const type = getValueType(val);
      switch (type) {
        case "string": {
          return (
            <Text
              style={STYLES.string}
              component="span"
              size={size}
              className="alepha-json-viewer-value"
              title={val}
            >
              "{val}"
            </Text>
          );
        }
        case "number":
          return (
            <Text component="span" size={size} style={STYLES.number}>
              {val}
            </Text>
          );
        case "boolean":
          return (
            <Text component="span" size={size} style={STYLES.boolean}>
              {String(val)}
            </Text>
          );
        case "null":
        case "undefined":
          return (
            <Text component="span" size={size} style={STYLES.null}>
              {type}
            </Text>
          );
        default:
          return (
            <Text component="span" size={size}>
              {String(val)}
            </Text>
          );
      }
    },
    [formatValue, showQuotes, size],
  );

  // Render tree node
  const renderNode = useCallback(
    ({
      node,
      expanded,
      hasChildren,
      elementProps,
    }: {
      node: JsonTreeNode;
      expanded: boolean;
      hasChildren: boolean;
      elementProps: any;
    }): ReactNode => {
      return (
        <JsonViewerRowNode
          node={node}
          expanded={expanded}
          hasChildren={hasChildren}
          elementProps={elementProps}
          size={size}
          config={config}
          showQuotes={showQuotes}
          showCopyButton={showCopyButton}
          renderValue={renderValue}
        />
      );
    },
    [config, renderValue, showCopyButton, showQuotes, size],
  );

  if (treeData.length === 0) {
    return (
      <Text size={size} style={STYLES.null}>
        {data === null ? "null" : data === undefined ? "undefined" : "{}"}
      </Text>
    );
  }

  return (
    <Tree
      data={treeData}
      tree={tree}
      levelOffset={config.levelOffset}
      expandOnClick
      renderNode={renderNode as any}
      styles={{ root: STYLES.root }}
    />
  );
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convert JSON to tree data structure.
 */
const buildTreeNodes = (
  data: any,
  path: string[] = [],
  key?: string,
  isArrayItem = false,
  maxDepth = 10,
): JsonTreeNode | null => {
  const currentPath = key !== undefined ? [...path, key] : path;
  const nodeId = currentPath.length > 0 ? currentPath.join(".") : "root";

  if (currentPath.length > maxDepth) {
    return {
      value: nodeId,
      label: key ?? "",
      nodeValue: data,
      nodeKey: key,
      path: currentPath,
      isArrayItem,
    };
  }

  const type = getValueType(data);

  if (type === "object" || type === "array") {
    const entries =
      type === "array"
        ? (data as any[]).map((v, i) => [String(i), v] as const)
        : Object.entries(data);

    const children = entries
      .map(([k, v]) =>
        buildTreeNodes(v, currentPath, k, type === "array", maxDepth),
      )
      .filter((n): n is JsonTreeNode => n !== null);

    return {
      value: nodeId,
      label: key ?? "",
      nodeValue: data,
      nodeKey: key,
      path: currentPath,
      isArrayItem,
      children: children.length > 0 ? children : undefined,
    };
  }

  return {
    value: nodeId,
    label: key ?? "",
    nodeValue: data,
    nodeKey: key,
    path: currentPath,
    isArrayItem,
  };
};

/**
 * Get all expandable node IDs up to a certain depth.
 */
const getExpandedIds = (
  nodes: JsonTreeNode[],
  targetDepth: number,
  currentDepth = 0,
): string[] => {
  if (currentDepth >= targetDepth) return [];
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children) {
      ids.push(node.value);
      ids.push(...getExpandedIds(node.children, targetDepth, currentDepth + 1));
    }
  }
  return ids;
};

export default JsonViewer;
