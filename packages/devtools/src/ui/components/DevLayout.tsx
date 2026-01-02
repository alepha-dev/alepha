import { NestedView } from "@alepha/react";
import {
  ActionButton,
  AdminShell,
  DarkModeButton,
  OmnibarButton,
} from "@alepha/ui";
import {
  IconApi,
  IconArchive,
  IconAtom,
  IconDashboard,
  IconDatabase,
  IconLogs,
  IconMessageCircle,
  IconStack2,
  IconTools,
  IconTopologyRing,
  IconVariable,
} from "@tabler/icons-react";

export const DevLayout = () => {
  return (
    <AdminShell
      sidebarProps={{
        gap: 4,
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
              <ActionButton
                intent={"none"}
                icon={IconTools}
                href={"/"}
                active={false}
              >
                Devtools
              </ActionButton>
            ),
          },
          {
            position: "center",
            element: <OmnibarButton />,
          },
          {
            position: "right",
            element: <DarkModeButton />,
          },
        ],
      }}
    >
      <NestedView />
    </AdminShell>
  );
};

export default DevLayout;
