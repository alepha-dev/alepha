import { AdminShell, DarkModeButton, OmnibarButton, ui } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  IconApi,
  IconArchive,
  IconAtom,
  IconDashboard,
  IconDatabase,
  IconLogs,
  IconMessageCircle,
  IconStack2,
  IconTopologyRing,
  IconVariable,
} from "@tabler/icons-react";

export const DevLayout = () => {
  return (
    <AdminShell
      appShellHeaderProps={{
        bg: ui.colors.background,
      }}
      appShellNavbarProps={{
        bg: ui.colors.background,
      }}
      sidebarResizable
      sidebarProps={{
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
          {
            label: "Logs",
            icon: <IconLogs />,
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
              <Flex
                h={"60px"}
                w={"78px"}
                style={{
                  marginLeft: "-32px",
                  borderRight: "1px solid var(--mantine-color-default-border)",
                }}
              />
            ),
          },
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
