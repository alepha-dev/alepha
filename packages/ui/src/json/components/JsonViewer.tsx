import {
  ActionIcon,
  Group,
  getTreeExpandedState,
  type MantineSize,
  Text,
  Tree,
  useTree,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
} from "@tabler/icons-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

// =============================================================================
// TYPES
// =============================================================================

interface JsonViewerProps {
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

interface JsonTreeNode {
  value: string;
  label: string;
  children?: JsonTreeNode[];
  // Custom properties
  nodeValue: any;
  nodeKey: string | undefined;
  path: string[];
  isArrayItem: boolean;
  isRoot?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SIZE_CONFIG: Record<MantineSize, { icon: number; levelOffset: number }> =
  {
    xs: { icon: 14, levelOffset: 16 },
    sm: { icon: 16, levelOffset: 20 },
    md: { icon: 18, levelOffset: 24 },
    lg: { icon: 20, levelOffset: 28 },
    xl: { icon: 22, levelOffset: 32 },
  };

const STYLES = {
  root: {
    fontFamily: "var(--mantine-font-family-monospace)",
  } satisfies CSSProperties,
  chevron: {
    flexShrink: 0,
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
  key: {
    color: "var(--mantine-color-cyan-text)",
    fontWeight: 500,
  } satisfies CSSProperties,
  colon: {
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
  string: {
    color: "var(--mantine-color-teal-text)",
  } satisfies CSSProperties,
  number: {
    color: "var(--mantine-color-blue-text)",
  } satisfies CSSProperties,
  boolean: {
    color: "var(--mantine-color-violet-text)",
  } satisfies CSSProperties,
  null: {
    color: "var(--mantine-color-dimmed)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  preview: {
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
};

// =============================================================================
// HELPERS
// =============================================================================

const getValueType = (val: any): string => {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (Array.isArray(val)) return "array";
  return typeof val;
};

// Convert JSON to tree data structure
function buildTreeNodes(
  data: any,
  path: string[] = [],
  key?: string,
  isArrayItem = false,
  maxDepth = 10,
): JsonTreeNode | null {
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
}

// Get all expandable node IDs up to a certain depth
function getExpandedIds(
  nodes: JsonTreeNode[],
  targetDepth: number,
  currentDepth = 0,
): string[] {
  if (currentDepth >= targetDepth) return [];
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children) {
      ids.push(node.value);
      ids.push(...getExpandedIds(node.children, targetDepth, currentDepth + 1));
    }
  }
  return ids;
}

// =============================================================================
// COPY BUTTON COMPONENT
// =============================================================================

const CopyButton = ({
  value,
  iconSize,
}: {
  value: string;
  iconSize: number;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [value],
  );

  return (
    <ActionIcon
      size={iconSize + 4}
      variant="transparent"
      c={copied ? "green" : "dimmed"}
      onClick={handleCopy}
      className="alepha-json-viewer-copy"
    >
      {copied ? <IconCheck size={iconSize} /> : <IconCopy size={iconSize} />}
    </ActionIcon>
  );
};

// =============================================================================
// ROW NODE COMPONENT
// =============================================================================

interface RowNodeProps {
  node: JsonTreeNode;
  expanded: boolean;
  hasChildren: boolean;
  elementProps: any;
  size: MantineSize;
  config: { icon: number; levelOffset: number };
  showQuotes: boolean;
  showCopyButton: boolean;
  renderValue: (val: any, key: string | undefined, path: string[]) => ReactNode;
}

const RowNode = ({
  node,
  expanded,
  hasChildren,
  elementProps,
  size,
  config,
  showQuotes,
  showCopyButton,
  renderValue,
}: RowNodeProps) => {
  const { nodeValue, nodeKey, path, isArrayItem, isRoot } = node;
  const type = getValueType(nodeValue);
  const isExpandable = type === "object" || type === "array";

  const getPreview = () => {
    if (!isExpandable) return null;
    const entries = type === "array" ? nodeValue : Object.keys(nodeValue);
    const count = entries.length;
    const label = type === "array" ? "item" : "key";

    // For root node or collapsed nodes, show the count
    if (!expanded) {
      return (
        <Text fs={"italic"} component="span" size={size} style={STYLES.preview}>
          {count === 0
            ? type === "array"
              ? "[]"
              : "{}"
            : type === "array"
              ? `[ ${count} ${count === 1 ? label : `${label}s`} ]`
              : `{ ${count} ${count === 1 ? label : `${label}s`} }`}
        </Text>
      );
    }

    return null;
  };

  const getCopyValue = () =>
    isExpandable ? JSON.stringify(nodeValue, null, 2) : String(nodeValue ?? "");

  return (
    <Group
      gap={6}
      wrap="nowrap"
      {...elementProps}
      className={`alepha-json-viewer-row ${elementProps.className || ""}`}
    >
      {hasChildren ? (
        expanded ? (
          <IconChevronDown size={config.icon} style={STYLES.chevron} />
        ) : (
          <IconChevronRight size={config.icon} style={STYLES.chevron} />
        )
      ) : (
        <span style={{ width: config.icon, flexShrink: 0 }} />
      )}

      {nodeKey !== undefined && !isArrayItem && (
        <Text component="span" size={size}>
          <span style={STYLES.key}>
            {showQuotes ? `"${nodeKey}"` : nodeKey}
          </span>
          <span style={STYLES.colon}>:</span>
        </Text>
      )}

      {nodeKey !== undefined && isArrayItem && (
        <Text component="span" size={size}>
          <span style={STYLES.key}>{nodeKey}</span>
          <span style={STYLES.colon}>:</span>
        </Text>
      )}

      {hasChildren ? (
        getPreview()
      ) : isExpandable ? (
        type === "array" ? (
          <Text component="span" size={size} style={STYLES.preview}>
            []
          </Text>
        ) : (
          <Text component="span" size={size} style={STYLES.preview}>
            {"{}"}
          </Text>
        )
      ) : (
        renderValue(nodeValue, nodeKey, path)
      )}

      {showCopyButton && (
        <CopyButton value={getCopyValue()} iconSize={config.icon} />
      )}
    </Group>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const JsonViewer = ({
  data,
  defaultExpandedDepth = 2,
  maxDepth = 10,
  size = "sm",
  showQuotes = false,
  showCopyButton = true,
  formatValue,
}: JsonViewerProps) => {
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
        <RowNode
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

export default JsonViewer;
