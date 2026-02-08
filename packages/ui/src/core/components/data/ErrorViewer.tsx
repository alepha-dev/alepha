import {
  ActionIcon,
  Collapse,
  CopyButton,
  Flex,
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
import { useState } from "react";

interface ErrorViewerProps {
  error: Error | unknown;
  showStack?: boolean;
  copyable?: boolean;
  size?: MantineSize;
}

const getSizeConfig = (size: MantineSize = "sm") => {
  const configs = {
    xs: { text: "xs", icon: 12, gap: 2 },
    sm: { text: "sm", icon: 14, gap: 4 },
    md: { text: "md", icon: 16, gap: 6 },
    lg: { text: "lg", icon: 18, gap: 8 },
    xl: { text: "xl", icon: 20, gap: 10 },
  };
  return configs[size] || configs.sm;
};

const parseStackTrace = (stack: string): string[] => {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const ErrorViewer = ({
  error,
  showStack = true,
  copyable = true,
  size = "sm",
}: ErrorViewerProps) => {
  const [stackExpanded, setStackExpanded] = useState(false);
  const sizeConfig = getSizeConfig(size);
  const copyIconSize = sizeConfig.icon + 2;

  const isError = error instanceof Error;
  const errorName = isError ? error.name : "Error";
  const errorMessage = isError ? error.message : String(error);
  const errorStack = isError ? error.stack : undefined;
  const stackLines = errorStack ? parseStackTrace(errorStack) : [];

  const getCopyContent = () => {
    if (isError) {
      return `${errorName}: ${errorMessage}${errorStack ? `\n\n${errorStack}` : ""}`;
    }
    return String(error);
  };

  return (
    <Flex pos="relative" w="100%">
      {copyable && (
        <Flex pos="absolute" top={0} right={0} style={{ zIndex: 1 }}>
          <CopyButton value={getCopyContent()}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied" : "Copy Error"}>
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
        </Flex>
      )}
      <Flex pt={copyable ? 30 : 0}>
        <Flex
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: sizeConfig.gap,
          }}
        >
          <Text
            component="span"
            c="red"
            ff="monospace"
            fw={600}
            size={sizeConfig.text}
          >
            {errorName}:
          </Text>
          <Text
            component="span"
            ff="monospace"
            size={sizeConfig.text}
            style={{ wordBreak: "break-word" }}
          >
            {errorMessage}
          </Text>
        </Flex>

        {showStack && stackLines.length > 1 && (
          <Flex mt="sm">
            <Flex
              style={{
                display: "flex",
                alignItems: "center",
                gap: sizeConfig.gap,
                cursor: "pointer",
              }}
              onClick={() => setStackExpanded(!stackExpanded)}
            >
              <ActionIcon size="xs" variant="transparent" c="dimmed">
                {stackExpanded ? (
                  <IconChevronDown size={sizeConfig.icon} />
                ) : (
                  <IconChevronRight size={sizeConfig.icon} />
                )}
              </ActionIcon>
              <Text c="dimmed" size={sizeConfig.text} fw={500}>
                Stack Trace ({stackLines.length - 1} frames)
              </Text>
            </Flex>

            <Collapse in={stackExpanded}>
              <Flex
                mt="xs"
                pl="md"
                style={{
                  borderLeft: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {stackLines.slice(1).map((line, index) => (
                  <Text
                    key={index}
                    ff="monospace"
                    size="xs"
                    c="dimmed"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {line}
                  </Text>
                ))}
              </Flex>
            </Collapse>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default ErrorViewer;
