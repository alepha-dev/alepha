import {
  ActionIcon,
  Box,
  Collapse,
  CopyButton,
  type MantineSize,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";

interface JsonViewerProps {
  data: any;
  defaultExpanded?: boolean;
  maxDepth?: number;
  copyable?: boolean;
  size?: MantineSize;
}

interface JsonNodeProps {
  name?: string;
  value: any;
  depth: number;
  maxDepth: number;
  isLast?: boolean;
  isArrayItem?: boolean;
  size?: MantineSize;
}

const getSizeConfig = (size: MantineSize = "sm") => {
  const configs = {
    xs: { text: "xs", icon: 12, indent: 16, gap: 2 },
    sm: { text: "sm", icon: 14, indent: 20, gap: 4 },
    md: { text: "md", icon: 16, indent: 24, gap: 6 },
    lg: { text: "lg", icon: 18, indent: 28, gap: 8 },
    xl: { text: "xl", icon: 20, indent: 32, gap: 10 },
  };
  return configs[size] || configs.sm;
};

const JsonNode = ({
  name,
  value,
  depth,
  maxDepth,
  isLast = false,
  isArrayItem = false,
  size = "sm",
}: JsonNodeProps) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const sizeConfig = getSizeConfig(size);

  const getValueType = (val: any): string => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (Array.isArray(val)) return "array";
    return typeof val;
  };

  const valueType = getValueType(value);

  const renderPrimitive = (val: any): ReactNode => {
    const type = getValueType(val);

    switch (type) {
      case "string":
        return (
          <Text
            component="span"
            c="teal"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            "{val}"
          </Text>
        );
      case "number":
        return (
          <Text
            component="span"
            c="blue"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            {val}
          </Text>
        );
      case "boolean":
        return (
          <Text
            component="span"
            c="violet"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            {String(val)}
          </Text>
        );
      case "null":
        return (
          <Text
            component="span"
            c="dimmed"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            null
          </Text>
        );
      case "undefined":
        return (
          <Text
            component="span"
            c="dimmed"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            undefined
          </Text>
        );
      default:
        return (
          <Text
            component="span"
            ff="monospace"
            size={sizeConfig.text}
            style={{ whiteSpace: "nowrap" }}
          >
            {String(val)}
          </Text>
        );
    }
  };

  const renderKey = () => {
    if (!name) return null;
    return (
      <Text
        component="span"
        c="cyan"
        ff="monospace"
        fw={500}
        size={sizeConfig.text}
      >
        {isArrayItem ? `[${name}]` : `"${name}"`}:
      </Text>
    );
  };

  if (valueType === "object" || valueType === "array") {
    const isObject = valueType === "object";
    const entries = isObject
      ? Object.entries(value)
      : value.map((v: any, i: number) => [i, v]);
    const isEmpty = entries.length === 0;
    const canExpand = depth < maxDepth && !isEmpty;

    const preview = isObject ? "{...}" : "[...]";
    const brackets = isObject ? ["{", "}"] : ["[", "]"];

    return (
      <Box>
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            gap: sizeConfig.gap,
            minWidth: "max-content",
          }}
        >
          {canExpand && (
            <ActionIcon
              size="xs"
              variant="transparent"
              c="dimmed"
              onClick={() => setExpanded(!expanded)}
              style={{ cursor: "pointer", flexShrink: 0 }}
            >
              {expanded ? (
                <IconChevronDown size={sizeConfig.icon} />
              ) : (
                <IconChevronRight size={sizeConfig.icon} />
              )}
            </ActionIcon>
          )}
          {!canExpand && (
            <Box w={sizeConfig.icon + 6} style={{ flexShrink: 0 }} />
          )}
          <Box style={{ flexShrink: 0 }}>{renderKey()}</Box>{" "}
          <Text
            component="span"
            c="dimmed"
            ff="monospace"
            size={sizeConfig.text}
            style={{ flexShrink: 0 }}
          >
            {brackets[0]}
          </Text>
          {!expanded && !isEmpty && (
            <Text
              component="span"
              c="dimmed"
              ff="monospace"
              fs="italic"
              size={sizeConfig.text}
              style={{ flexShrink: 0 }}
            >
              {preview}
            </Text>
          )}
          {(isEmpty || !expanded) && (
            <Text
              component="span"
              c="dimmed"
              ff="monospace"
              size={sizeConfig.text}
              style={{ flexShrink: 0 }}
            >
              {brackets[1]}
            </Text>
          )}
          {!isEmpty && !expanded && (
            <Text
              component="span"
              c="dimmed"
              size={sizeConfig.text}
              style={{ flexShrink: 0 }}
            >
              {entries.length} {entries.length === 1 ? "item" : "items"}
            </Text>
          )}
        </Box>

        <Collapse in={expanded && canExpand}>
          <Box
            pl={sizeConfig.indent}
            style={{
              borderLeft: "1px solid var(--mantine-color-default-border)",
              marginLeft: Math.floor((sizeConfig.icon + 6) / 2),
            }}
          >
            {entries.map(
              ([key, val]: [string | number, any], index: number) => (
                <JsonNode
                  key={String(key)}
                  name={String(key)}
                  value={val}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  isLast={index === entries.length - 1}
                  isArrayItem={!isObject}
                  size={size}
                />
              ),
            )}
          </Box>
          <Box style={{ display: "flex", minWidth: "max-content" }}>
            <Box w={sizeConfig.icon + 6} style={{ flexShrink: 0 }} />
            <Text
              c="dimmed"
              ff="monospace"
              size={sizeConfig.text}
              style={{ flexShrink: 0 }}
            >
              {brackets[1]}
            </Text>
          </Box>
        </Collapse>
      </Box>
    );
  }

  return (
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        gap: sizeConfig.gap,
        minWidth: "max-content",
      }}
    >
      <Box w={sizeConfig.icon + 6} style={{ flexShrink: 0 }} />
      <Box style={{ flexShrink: 0 }}>{renderKey()}</Box>
      <Box style={{ flexShrink: 0 }}>{renderPrimitive(value)}</Box>
      {!isLast && (
        <Text
          component="span"
          c="dimmed"
          ff="monospace"
          size={sizeConfig.text}
          style={{ flexShrink: 0 }}
        >
          ,
        </Text>
      )}
    </Box>
  );
};

export const JsonViewer = ({
  data,
  defaultExpanded = true,
  maxDepth = 10,
  copyable = true,
  size = "sm",
}: JsonViewerProps) => {
  const sizeConfig = getSizeConfig(size);
  const copyIconSize = sizeConfig.icon + 2;

  return (
    <Box pos="relative">
      {copyable && (
        <Box pos="absolute" top={0} right={0} style={{ zIndex: 1 }}>
          <CopyButton value={JSON.stringify(data, null, 2)}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied" : "Copy JSON"}>
                <ActionIcon
                  color={copied ? "teal" : "gray"}
                  variant="subtle"
                  onClick={copy}
                  size={size}
                >
                  {copied ? (
                    <IconCheck size={copyIconSize} />
                  ) : (
                    <IconCopy size={copyIconSize} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Box>
      )}
      <Box pt={copyable ? 30 : 0} style={{ overflowX: "auto" }}>
        <JsonNode value={data} depth={0} maxDepth={maxDepth} size={size} />
      </Box>
    </Box>
  );
};

export default JsonViewer;
