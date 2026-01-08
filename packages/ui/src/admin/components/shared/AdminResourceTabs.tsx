import { useActive, useRouter } from "@alepha/react/router";
import { Tabs } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";

export interface AdminResourceTab {
  /**
   * Tab key/value
   */
  value: string;

  /**
   * Tab label
   */
  label: string;

  /**
   * Tab icon
   */
  icon?: ComponentType<{ size?: number }>;

  /**
   * Navigation href
   */
  href: string;

  /**
   * Whether tab is disabled
   */
  disabled?: boolean;

  /**
   * Badge count to show
   */
  count?: number;
}

export interface AdminResourceTabsProps {
  /**
   * Array of tab configurations
   */
  tabs: AdminResourceTab[];

  /**
   * Currently active tab value
   */
  activeTab?: string;

  /**
   * Content to render below tabs
   */
  children?: ReactNode;
}

const TabItem = (props: { tab: AdminResourceTab }) => {
  const { tab } = props;
  const router = useRouter();
  const { isActive, isPending } = useActive({ href: tab.href });
  const anchorProps = router.anchor(tab.href);

  return (
    <Tabs.Tab
      value={tab.value}
      component="a"
      leftSection={tab.icon ? <tab.icon size={16} /> : undefined}
      disabled={tab.disabled}
      data-active={isActive || undefined}
      style={{
        opacity: isPending ? 0.6 : 1,
      }}
      {...anchorProps}
    >
      {tab.label}
      {tab.count !== undefined && tab.count > 0 && ` (${tab.count})`}
    </Tabs.Tab>
  );
};

const AdminResourceTabs = (props: AdminResourceTabsProps) => {
  const { tabs, activeTab, children } = props;

  return (
    <Tabs value={activeTab} variant="default">
      <Tabs.List>
        {tabs.map((tab) => (
          <TabItem key={tab.value} tab={tab} />
        ))}
      </Tabs.List>

      {children}
    </Tabs>
  );
};

export default AdminResourceTabs;
