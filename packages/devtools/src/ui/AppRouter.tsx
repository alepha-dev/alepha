import { $page } from "@alepha/react";
import {
  AdminShell,
  DarkModeButton,
  OmnibarButton,
  RootRouter,
  Text,
  ui,
} from "@alepha/ui";
import ToggleSidebarButton from "@alepha/ui/src/components/buttons/ToggleSidebarButton.tsx";
import { IconDashboard, IconLogs } from "@tabler/icons-react";
import DevLogs from "./DevLogs.tsx";

export class AppRouter extends RootRouter {
  layout = $page({
    parent: this.root,
    component: () => (
      <AdminShell
        appShellProps={{
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
          menu: [
            {
              element: <ToggleSidebarButton />,
            },
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
                <Text fw="bold" size="lg">
                  Alepha DevTools
                </Text>
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
      />
    ),
  });

  dashboard = $page({
    path: "/",
    label: "Dashboard",
    icon: <IconDashboard />,
    static: true,
    parent: this.layout,
    component: () => <div>Dashboard</div>,
  });

  logs = $page({
    path: "/logs",
    label: "Logs",
    icon: <IconLogs />,
    static: true,
    parent: this.layout,
    component: DevLogs,
  });
}
