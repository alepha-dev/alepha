import { Flex, type MantineSize, Text } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { JsonViewerCopyButton } from "./JsonViewerCopyButton.tsx";
import { getValueType, type JsonTreeNode, STYLES } from "./JsonViewerShared.ts";

// =============================================================================
// PROPS
// =============================================================================

export interface JsonViewerRowNodeProps {
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

// =============================================================================
// COMPONENT
// =============================================================================

export const JsonViewerRowNode = (props: JsonViewerRowNodeProps) => {
  const { nodeValue, nodeKey, path, isArrayItem } = props.node;
  const type = getValueType(nodeValue);
  const isExpandable = type === "object" || type === "array";

  const getPreview = () => {
    if (!isExpandable) return null;
    const entries = type === "array" ? nodeValue : Object.keys(nodeValue);
    const count = entries.length;
    const label = type === "array" ? "item" : "key";

    if (!props.expanded) {
      return (
        <Text
          fs={"italic"}
          component="span"
          size={props.size}
          style={STYLES.preview}
        >
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
    <Flex
      gap={6}
      wrap="nowrap"
      {...props.elementProps}
      className={`alepha-json-viewer-row ${props.elementProps.className || ""}`}
    >
      {props.hasChildren ? (
        props.expanded ? (
          <IconChevronDown size={props.config.icon} style={STYLES.chevron} />
        ) : (
          <IconChevronRight size={props.config.icon} style={STYLES.chevron} />
        )
      ) : (
        <span style={{ width: props.config.icon, flexShrink: 0 }} />
      )}

      {nodeKey !== undefined && !isArrayItem && (
        <Text component="span" size={props.size}>
          <span style={STYLES.key}>
            {props.showQuotes ? `"${nodeKey}"` : nodeKey}
          </span>
          <span style={STYLES.colon}>:</span>
        </Text>
      )}

      {nodeKey !== undefined && isArrayItem && (
        <Text component="span" size={props.size}>
          <span style={STYLES.key}>{nodeKey}</span>
          <span style={STYLES.colon}>:</span>
        </Text>
      )}

      {props.hasChildren ? (
        getPreview()
      ) : isExpandable ? (
        type === "array" ? (
          <Text component="span" size={props.size} style={STYLES.preview}>
            []
          </Text>
        ) : (
          <Text component="span" size={props.size} style={STYLES.preview}>
            {"{}"}
          </Text>
        )
      ) : (
        props.renderValue(nodeValue, nodeKey, path)
      )}

      {props.showCopyButton && (
        <JsonViewerCopyButton
          value={getCopyValue()}
          iconSize={props.config.icon}
        />
      )}
    </Flex>
  );
};
