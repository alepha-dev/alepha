import { NestedView } from "@alepha/react";
import {
  ActionButton,
  AdminShell,
  DarkModeButton,
  OmnibarButton,
  ui,
} from "@alepha/ui";
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
  IconTools,
  IconTopologyRing,
  IconVariable,
} from "@tabler/icons-react";

export const DevLayout = () => {
  return (
    <AdminShell
      appShellProps={{
        withBorder: false,
        bg: ui.colors.background,
      }}
      appShellNavbarProps={{
        bg: ui.colors.transparent,
      }}
      appShellHeaderProps={{
        bg: ui.colors.transparent,
        style: {
          backdropFilter: "blur(10px)",
        },
      }}
      sidebarProps={{
        gap: "xs",
        collapsed: true,
        menu: [
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
      <Flex
        className={"overflow-auto"}
        w={"100%"}
        flex={1}
        direction={"column"}
        bd={`1px solid ${ui.colors.border}`}
        bg={ui.colors.elevated}
        ml={-16}
        mr={-16}
        mt={-16}
        style={{
          borderTopLeftRadius: 16,
        }}
      >
        <NestedView />
      </Flex>
    </AdminShell>
  );
};

export default DevLayout;
