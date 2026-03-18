import { Tabs } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import AdminResourceTabsItem from "./AdminResourceTabsItem.tsx";

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

const AdminResourceTabs = (props: AdminResourceTabsProps) => {
  const { tabs, activeTab, children } = props;

  return (
    <Tabs value={activeTab} variant="default">
      <Tabs.List>
        {tabs.map((tab) => (
          <AdminResourceTabsItem key={tab.value} tab={tab} />
        ))}
      </Tabs.List>

      {children}
    </Tabs>
  );
};

export default AdminResourceTabs;
