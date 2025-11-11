import { $page } from "@alepha/react";
import { RootRouter } from "@alepha/ui";
import { IconDashboard, IconLogs } from "@tabler/icons-react";

export class AppRouter extends RootRouter {
  layout = $page({
    parent: this.root,
    lazy: () => import("./components/DevLayout.tsx"),
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
    lazy: () => import("./components/DevLogViewer.tsx"),
  });
}
