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
  iconWidth: number;
}

const getSizeConfig = (size: MantineSize = "sm") => {
  const configs = {
    xs: { text: "xs" as const, icon: 12, indent: 16, gap: 4, iconWidth: 18 },
    sm: { text: "sm" as const, icon: 14, indent: 20, gap: 6, iconWidth: 20 },
    md: { text: "md" as const, icon: 16, indent: 24, gap: 8, iconWidth: 22 },
    lg: { text: "lg" as const, icon: 18, indent: 28, gap: 10, iconWidth: 24 },
    xl: { text: "xl" as const, icon: 20, indent: 32, gap: 12, iconWidth: 26 },
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
  iconWidth,
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

    const textProps = {
      component: "span" as const,
      ff: "monospace" as const,
      size: sizeConfig.text,
    };

    switch (type) {
      case "string":
        return (
          <Text {...textProps} c="teal">
            "{val}"
          </Text>
        );
      case "number":
        return (
          <Text {...textProps} c="blue">
            {val}
          </Text>
        );
      case "boolean":
        return (
          <Text {...textProps} c="violet">
            {String(val)}
          </Text>
        );
      case "null":
        return (
          <Text {...textProps} c="dimmed">
            null
          </Text>
        );
      case "undefined":
        return (
          <Text {...textProps} c="dimmed">
            undefined
          </Text>
        );
      default:
        return <Text {...textProps}>{String(val)}</Text>;
    }
  };

  const renderKey = () => {
    if (name === undefined) return null;
    return (
      <Text
        component="span"
        c="cyan"
        ff="monospace"
        fw={500}
        size={sizeConfig.text}
      >
        {isArrayItem ? `[${name}]` : `"${name}"`}
      </Text>
    );
  };

  const comma = !isLast && (
    <Text component="span" c="dimmed" ff="monospace" size={sizeConfig.text}>
      ,
    </Text>
  );

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
            display: "grid",
            gridTemplateColumns: `${iconWidth}px auto`,
            alignItems: "center",
          }}
        >
          <Box
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {canExpand && (
              <ActionIcon
                size="xs"
                variant="transparent"
                c="dimmed"
                onClick={() => setExpanded(!expanded)}
                style={{ cursor: "pointer" }}
              >
                {expanded ? (
                  <IconChevronDown size={sizeConfig.icon} />
                ) : (
                  <IconChevronRight size={sizeConfig.icon} />
                )}
              </ActionIcon>
            )}
          </Box>
          <Box
            style={{
              display: "flex",
              alignItems: "center",
              gap: sizeConfig.gap,
            }}
          >
            {renderKey()}
            {name !== undefined && (
              <Text
                component="span"
                c="dimmed"
                ff="monospace"
                size={sizeConfig.text}
              >
                :
              </Text>
            )}
            <Text
              component="span"
              c="dimmed"
              ff="monospace"
              size={sizeConfig.text}
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
              >
                {preview}
              </Text>
            )}
            {(isEmpty || !expanded) && (
              <>
                <Text
                  component="span"
                  c="dimmed"
                  ff="monospace"
                  size={sizeConfig.text}
                >
                  {brackets[1]}
                </Text>
                {comma}
              </>
            )}
            {!isEmpty && !expanded && (
              <Text component="span" c="dimmed" size={sizeConfig.text}>
                {entries.length} {entries.length === 1 ? "item" : "items"}
              </Text>
            )}
          </Box>
        </Box>

        <Collapse in={expanded && canExpand}>
          <Box
            pl={sizeConfig.indent}
            ml={iconWidth / 2}
            style={{
              borderLeft: "1px solid var(--mantine-color-default-border)",
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
                  iconWidth={iconWidth}
                />
              ),
            )}
          </Box>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: `${iconWidth}px auto`,
            }}
          >
            <Box />
            <Box style={{ display: "flex", gap: sizeConfig.gap }}>
              <Text c="dimmed" ff="monospace" size={sizeConfig.text}>
                {brackets[1]}
              </Text>
              {comma}
            </Box>
          </Box>
        </Collapse>
      </Box>
    );
  }

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: `${iconWidth}px auto`,
        alignItems: "center",
      }}
    >
      <Box />
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          gap: sizeConfig.gap,
        }}
      >
        {renderKey()}
        {name !== undefined && (
          <Text
            component="span"
            c="dimmed"
            ff="monospace"
            size={sizeConfig.text}
          >
            :
          </Text>
        )}
        {renderPrimitive(value)}
        {comma}
      </Box>
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
    <Box pos="relative" w="100%">
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
        <JsonNode
          value={data}
          depth={0}
          maxDepth={maxDepth}
          size={size}
          iconWidth={sizeConfig.iconWidth}
        />
      </Box>
    </Box>
  );
};

export default JsonViewer;
