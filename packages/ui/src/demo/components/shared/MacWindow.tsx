import { Flex, type FlexProps, SegmentedControl } from "@mantine/core";
import { type ReactNode, useState } from "react";

export interface MacWindowProps {
  children: ReactNode;
  title?: string;
  containerProps?: FlexProps;
  fill?: boolean;
}

type WindowSize = "25" | "50" | "75" | "100";

const MacWindow = ({
  children,
  title,
  containerProps,
  fill,
}: MacWindowProps) => {
  const [size, setSize] = useState<WindowSize>("100");

  const getWidth = () => {
    return `${size}%`;
  };

  return (
    <Flex
      direction="column"
      flex={fill ? 1 : undefined}
      h={fill ? "100%" : undefined}
      bdrs={"md"}
      style={{
        width: getWidth(),
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
          <Flex
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#ff5f57" }}
          />
          <Flex
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#febc2e" }}
          />
          <Flex
            w={12}
            h={12}
            style={{ borderRadius: "50%", background: "#28c840" }}
          />
        </Flex>

        <Flex
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 13,
            color: "var(--mantine-color-dimmed)",
          }}
        >
          {title}
        </Flex>

        {fill ? undefined : (
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
        )}
      </Flex>
      <Flex
        direction={"column"}
        flex={fill ? 1 : undefined}
        p="md"
        {...containerProps}
      >
        {children}
      </Flex>
    </Flex>
  );
};

export default MacWindow;
