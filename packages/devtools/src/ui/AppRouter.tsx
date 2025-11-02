import { $page } from "@alepha/react";
import { AdminShell, RootRouter } from "@alepha/ui";
import { IconDashboard, IconLogs } from "@tabler/icons-react";
import DevLogs from "./DevLogs.tsx";

export class AppRouter extends RootRouter {
  layout = $page({
    parent: this.root,
    component: () => <AdminShell />,
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
