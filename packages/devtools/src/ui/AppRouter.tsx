import { $ui, midnightTheme } from "@alepha/ui";
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
import { $page } from "alepha/react/router";

export class AppRouter {
  ui = $ui({
    themes: [midnightTheme],
  });

  layout = $page({
    parent: this.ui.root,
    lazy: () => import("./components/DevLayout.tsx"),
  });

  dashboard = $page({
    path: "/",
    label: "Dashboard",
    icon: <IconDashboard />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevDashboard.tsx"),
  });

  actions = $page({
    path: "/actions",
    label: "Actions",
    icon: <IconApi />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/actions/DevActionsExplorer.tsx"),
  });

  queues = $page({
    path: "/queues",
    label: "Queues",
    icon: <IconStack2 />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevQueueMonitor.tsx"),
  });

  topics = $page({
    path: "/topics",
    label: "Topics",
    icon: <IconMessageCircle />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevTopicsViewer.tsx"),
  });

  caches = $page({
    path: "/caches",
    label: "Caches",
    icon: <IconArchive />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevCacheInspector.tsx"),
  });

  env = $page({
    path: "/env",
    label: "Environment",
    icon: <IconVariable />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevEnvExplorer.tsx"),
  });

  atoms = $page({
    path: "/atoms",
    label: "Atoms",
    icon: <IconAtom />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/DevAtomsViewer.tsx"),
  });

  db = $page({
    path: "/db",
    label: "DB Studio",
    icon: <IconDatabase />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/db/DevDbStudio.tsx"),
  });

  graph = $page({
    path: "/graph",
    label: "Graph",
    icon: <IconTopologyRing />,
    static: true,
    parent: this.layout,
    lazy: () => import("./components/graph/DevDependencyGraph.tsx"),
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
