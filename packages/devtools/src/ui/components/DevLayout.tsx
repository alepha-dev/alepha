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
        w={"100%"}
        flex={1}
        bd={`1px solid ${ui.colors.border}`}
        bg={ui.colors.elevated}
        p={"xl"}
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
