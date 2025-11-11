import { NestedView } from "@alepha/react";
import {
  ActionButton,
  AdminShell,
  DarkModeButton,
  Flex,
  OmnibarButton,
  ui,
} from "@alepha/ui";
import { IconDashboard, IconLogs, IconTools } from "@tabler/icons-react";

export const DevLayout = () => {
  return (
    <AdminShell
      appShellProps={{
        withBorder: false,
        bg: ui.colors.surface,
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
              <ActionButton icon={<IconTools />} href={"/"} active={false}>
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
        bd={`1px solid ${ui.colors.border}`}
        bg={ui.colors.elevated}
        bdrs={"lg"}
        p={"xl"}
        ml={-8}
        mt={-8}
      >
        <NestedView />
      </Flex>
    </AdminShell>
  );
};

export default DevLayout;
