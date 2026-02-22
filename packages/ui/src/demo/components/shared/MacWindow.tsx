import {
  Flex,
  type FlexProps,
  Portal,
  SegmentedControl,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";

export interface MacWindowProps {
  children: ReactNode;
  title?: string;
  containerProps?: FlexProps;
}

type DeviceSize = "phone" | "tablet" | "desktop" | "full";

const DEVICE_WIDTHS: Record<DeviceSize, string> = {
  phone: "375px",
  tablet: "768px",
  desktop: "100%",
  full: "100%",
};

const MacWindow = ({ children, title, containerProps }: MacWindowProps) => {
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const isFullPage = device === "full";

  const controls = (
    <SegmentedControl
      size="xs"
      value={device}
      onChange={(v) => setDevice(v as DeviceSize)}
      data={[
        {
          label: (
            <Tooltip label="Phone (375px)" openDelay={400}>
              <Flex align="center">
                <IconDeviceMobile size={14} />
              </Flex>
            </Tooltip>
          ),
          value: "phone",
        },
        {
          label: (
            <Tooltip label="Tablet (768px)" openDelay={400}>
              <Flex align="center">
                <IconDeviceTablet size={14} />
              </Flex>
            </Tooltip>
          ),
          value: "tablet",
        },
        {
          label: (
            <Tooltip label="Desktop (100%)" openDelay={400}>
              <Flex align="center">
                <IconDeviceDesktop size={14} />
              </Flex>
            </Tooltip>
          ),
          value: "desktop",
        },
        {
          label: (
            <Tooltip label="Full page" openDelay={400}>
              <Flex align="center">
                <IconArrowsMaximize size={14} />
              </Flex>
            </Tooltip>
          ),
          value: "full",
        },
      ]}
    />
  );

  const header = (
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

      {controls}
    </Flex>
  );

  const body = (
    <Flex
      direction={"column"}
      flex={1}
      p="md"
      style={{ overflow: "auto" }}
      {...containerProps}
    >
      {children}
    </Flex>
  );

  if (isFullPage) {
    return (
      <Portal>
        <Flex
          direction="column"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "var(--mantine-color-body)",
          }}
        >
          {header}
          {body}
        </Flex>
      </Portal>
    );
  }

  return (
    <Flex
      direction="column"
      bdrs={"md"}
      style={{
        width: DEVICE_WIDTHS[device],
        maxWidth: "100%",
        border: "1px solid var(--mantine-color-default-border)",
        overflow: "hidden",
        background: "var(--mantine-color-body)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        transition: "width 0.3s ease",
      }}
    >
      {header}
      {body}
    </Flex>
  );
};

export default MacWindow;
