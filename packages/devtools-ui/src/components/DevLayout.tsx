import { DarkModeButton, DashboardShell, OmnibarButton } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  IconApi,
  IconArchive,
  IconAtom,
  IconDashboard,
  IconDatabase,
  IconMessageCircle,
  IconStack2,
  IconTopologyRing,
  IconVariable,
} from "@tabler/icons-react";
import { useRouter } from "alepha/react/router";

export const DevLayout = () => {
  const router = useRouter();
  return (
    <DashboardShell
      layout={"alt"}
      appShellMainProps={{
        style: {
          display: "flex",
          flexDirection: "column",
        },
      }}
      headerHeight={60}
      navbarHeader={
        <Flex align="center" justify={"center"} h="100%" w={"100%"}></Flex>
      }
      sidebarResizable={false}
      sidebarProps={{
        collapsed: true,
        items: [
          {
            label: "Dashboard",
            icon: <IconDashboard />,
            href: "/",
          },
          { type: "divider" },
          {
            label: "Actions",
            icon: <IconApi />,
            href: "/actions",
          },
          {
            label: "Queues",
            icon: <IconStack2 />,
            href: "/queues",
          },
          {
            label: "Topics",
            icon: <IconMessageCircle />,
            href: "/topics",
          },
          {
            label: "Caches",
            icon: <IconArchive />,
            href: "/caches",
          },
          {
            label: "DB Studio",
            icon: <IconDatabase />,
            href: "/db",
          },
          { type: "divider" },
          {
            label: "Environment",
            icon: <IconVariable />,
            href: "/env",
          },
          {
            label: "Atoms",
            icon: <IconAtom />,
            href: "/atoms",
          },
          { type: "divider" },
          {
            label: "Graph",
            icon: <IconTopologyRing />,
            href: "/graph",
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
