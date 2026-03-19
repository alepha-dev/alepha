import { Flex, Text } from "@alepha/ui";
import { Collapse, UnstyledButton } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconSettings,
} from "@tabler/icons-react";
import type { ParameterTreeNode as ParameterTreeNodeData } from "alepha/api/parameters";
import { memo, useCallback, useState } from "react";

interface Props {
  node: ParameterTreeNodeData;
  level: number;
  selectedConfig: string | null;
  onSelect: (name: string) => void;
  expandedNodes: Set<string>;
  onToggle: (path: string) => void;
}

/**
 * Memoized tree node to prevent unnecessary re-renders.
 */
const ParameterTreeNode = memo((props: Props) => {
  const [isHovered, setIsHovered] = useState(false);
  const hasChildren = props.node.children.length > 0;
  const isExpanded = props.expandedNodes.has(props.node.path);
  const isSelected = props.selectedConfig === props.node.path;
  const isLeaf = !hasChildren;

  const handleClick = useCallback(() => {
    if (hasChildren) {
      props.onToggle(props.node.path);
    } else {
      props.onSelect(props.node.path);
    }
  }, [hasChildren, props.node.path, props.onToggle, props.onSelect]);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  return (
    <Flex>
      <UnstyledButton
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        w="100%"
        style={{ display: "block" }}
      >
        <Flex
          gap={6}
          wrap="nowrap"
          p="4px 8px"
          pl={8 + props.level * 16}
          style={{
            borderRadius: "var(--mantine-radius-sm)",
            backgroundColor:
              isSelected || isHovered
                ? "var(--mantine-color-default-hover)"
                : undefined,
          }}
        >
          {hasChildren ? (
            <>
              <Flex
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                }}
              >
                {isExpanded ? (
                  <IconChevronDown
                    size={14}
                    color="var(--mantine-color-dimmed)"
                  />
                ) : (
                  <IconChevronRight
                    size={14}
                    color="var(--mantine-color-dimmed)"
                  />
                )}
              </Flex>
              {isExpanded ? (
                <IconFolderOpen
                  size={16}
                  color="var(--mantine-color-dimmed)"
                  style={{ flexShrink: 0 }}
                />
              ) : (
                <IconFolder
                  size={16}
                  color="var(--mantine-color-dimmed)"
                  style={{ flexShrink: 0 }}
                />
              )}
            </>
          ) : (
            <>
              <Flex w={16} />
              <IconSettings
                size={16}
                color={
                  isSelected
                    ? "var(--mantine-color-blue-6)"
                    : "var(--mantine-color-dimmed)"
                }
                style={{ flexShrink: 0 }}
              />
            </>
          )}
          <Text
            size="sm"
            fw={isSelected ? 600 : 400}
            c={isSelected ? undefined : isLeaf ? undefined : "dimmed"}
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {props.node.name}
          </Text>
        </Flex>
      </UnstyledButton>

      {hasChildren && (
        <Collapse in={isExpanded}>
          {props.node.children.map((child: ParameterTreeNodeData) => (
            <ParameterTreeNode
              key={child.path}
              node={child}
              level={props.level + 1}
              selectedConfig={props.selectedConfig}
              onSelect={props.onSelect}
              expandedNodes={props.expandedNodes}
              onToggle={props.onToggle}
            />
          ))}
        </Collapse>
      )}
    </Flex>
  );
});

ParameterTreeNode.displayName = "ParameterTreeNode";

export default ParameterTreeNode;
