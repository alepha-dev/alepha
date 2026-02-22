import {
  Drawer,
  type DrawerProps,
  Flex,
  Loader,
  Tabs,
  Text,
} from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import type { ActionMenuItem } from "../buttons/ActionButton.tsx";
import ActionButton from "../buttons/ActionButton.tsx";

export interface DetailDrawerTab {
  value: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  content: ReactNode;
}

export interface DetailDrawerStatus {
  label: string;
  active: boolean;
}

export interface DetailDrawerProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: DetailDrawerStatus;
  actions?: ActionMenuItem[];
  tabs?: DetailDrawerTab[];
  children?: ReactNode;
  loading?: boolean;
  size?: DrawerProps["size"];
  defaultTab?: string;
}

const DetailDrawer = ({
  opened,
  onClose,
  title,
  subtitle,
  status,
  actions,
  tabs,
  children,
  loading,
  size = "xl",
  defaultTab,
}: DetailDrawerProps) => (
  <Drawer
    opened={opened}
    onClose={onClose}
    position="right"
    size={size}
    withCloseButton={false}
    padding={0}
  >
    {/* Header */}
    <Flex
      p="md"
      justify="space-between"
      align="flex-start"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <Flex direction="column" gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Flex gap="xs" align="center">
          {status && (
            <Flex
              w={8}
              h={8}
              style={{
                borderRadius: "50%",
                backgroundColor: status.active
                  ? "var(--mantine-color-green-6)"
                  : "var(--mantine-color-red-6)",
                flexShrink: 0,
              }}
            />
          )}
          <Text size="lg" fw={600} truncate>
            {title}
          </Text>
        </Flex>
        {subtitle && (
          <Text size="sm" c="dimmed" truncate>
            {subtitle}
          </Text>
        )}
      </Flex>
      <Flex gap="xs" align="center" style={{ flexShrink: 0 }}>
        {actions && actions.length > 0 && (
          <ActionButton
            variant="default"
            size="xs"
            menu={{
              items: actions,
              position: "bottom-end",
              width: 200,
            }}
          >
            Actions
          </ActionButton>
        )}
        <ActionButton variant="subtle" size="xs" c="dimmed" onClick={onClose}>
          Close
        </ActionButton>
      </Flex>
    </Flex>

    {/* Content */}
    {loading ? (
      <Flex flex={1} justify="center" align="center" py="xl">
        <Loader />
      </Flex>
    ) : tabs && tabs.length > 0 ? (
      <Tabs defaultValue={defaultTab || tabs[0].value}>
        <Tabs.List px="md">
          {tabs.map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              leftSection={tab.icon ? <tab.icon size={14} /> : undefined}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.value} value={tab.value} p="md">
            {tab.content}
          </Tabs.Panel>
        ))}
      </Tabs>
    ) : (
      <Flex direction="column" p="md">
        {children}
      </Flex>
    )}
  </Drawer>
);

export default DetailDrawer;
