import { DarkModeButton, DashboardShell, OmnibarButton } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  IconDashboard,
  IconDatabase,
  IconList,
  IconSettings,
  IconSitemap,
  IconTopologyRing,
} from "@tabler/icons-react";

export const DevLayout = () => {
  return (
    <DashboardShell
      layout={"alt"}
      appShellMainProps={{
        style: {
          display: "flex",
          flexDirection: "column",
        },
      }}
      footer={<Flex />}
      navbarFooter={<Flex />}
      footerHeight={24}
      headerHeight={60}
      navbarHeader={
        <Flex align="center" justify={"center"} h="100%" w={"100%"}></Flex>
      }
      sidebarResizable={false}
      sidebarProps={{
        expandOnHover: false,
        collapsed: true,
        items: [
          {
            label: "Dashboard",
            icon: <IconDashboard />,
            href: "/",
          },
          { type: "divider" },
          {
            label: "Explorer",
            icon: <IconSitemap />,
            href: "/explorer",
          },
          {
            label: "Database",
            icon: <IconDatabase />,
            href: "/db/erd",
          },
          {
            label: "Configuration",
            icon: <IconSettings />,
            href: "/conf/env",
          },
          { type: "divider" },
          {
            label: "Graph",
            icon: <IconTopologyRing />,
            href: "/graph",
          },
          {
            label: "Logs",
            icon: <IconList />,
            href: "/logs",
          },
        ],
      }}
      appBarProps={{
        items: [
          { position: "left", type: "burger" },
          {
            position: "left",
            element: (
              <OmnibarButton
                actionProps={{
                  variant: "outline",
                  bd: "1px solid var(--mantine-color-default-border)",
                }}
              />
            ),
          },
          {
            position: "right",
            element: <DarkModeButton />,
          },
        ],
      }}
    />
  );
};

export default DevLayout;
