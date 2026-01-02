import { Box, Flex, SegmentedControl } from "@mantine/core";
import { type ReactNode, useState } from "react";

export interface MacWindowProps {
  children: ReactNode;
  title?: string;
}

type WindowSize = "25" | "50" | "75" | "100";

const MacWindow = ({ children, title }: MacWindowProps) => {
  const [size, setSize] = useState<WindowSize>("100");

  const getWidth = () => {
    return `${size}%`;
  };

  return (
    <Box
      style={{
        width: getWidth(),
        borderRadius: 8,
        border: "1px solid var(--mantine-color-default-border)",
        overflow: "hidden",
        background: "var(--mantine-color-body)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        transition: "width 0.3s ease",
      }}
    >
      <Flex
        h={36}
        px="sm"
        align="center"
        gap={8}
        style={{
          background: "var(--mantine-color-default)",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Flex gap={6}>
          <Box
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#ff5f57" }}
          />
          <Box
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#febc2e" }}
          />
          <Box
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#28c840" }}
          />
        </Flex>

        <Box
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 13,
            color: "var(--mantine-color-dimmed)",
          }}
        >
          {title}
        </Box>

        <SegmentedControl
          size="xs"
          value={size}
          onChange={(v) => setSize(v as WindowSize)}
          data={[
            { label: "25", value: "25" },
            { label: "50", value: "50" },
            { label: "75", value: "75" },
            { label: "100", value: "100" },
          ]}
        />
      </Flex>
      <Box p="md">{children}</Box>
    </Box>
  );
};

export default MacWindow;
