import { $page } from "@alepha/react";
import { AdminShell, RootRouter, Text, ui } from "@alepha/ui";
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
          collapsed: true,
          gap: "xs",
        }}
        appBarProps={{
          items: [
            { position: "left", type: "burger" },
            {
              position: "center",
              element: (
                <Text fw="bold" size="lg">
                  Alepha DevTools
                </Text>
              ),
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
