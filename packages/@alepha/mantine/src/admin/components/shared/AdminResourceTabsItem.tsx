import { Tabs } from "@mantine/core";
import { useActive, useRouter } from "alepha/react/router";
import type { AdminResourceTab } from "./AdminResourceTabs.tsx";

export interface AdminResourceTabsItemProps {
  /**
   * Tab configuration
   */
  tab: AdminResourceTab;
}

const AdminResourceTabsItem = (props: AdminResourceTabsItemProps) => {
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

export default AdminResourceTabsItem;
