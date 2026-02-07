import { $ui, midnightTheme } from "@alepha/ui";
import {
  IconApi,
  IconArchive,
  IconAtom,
  IconDashboard,
  IconDatabase,
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
    parent: this.layout,
    lazy: () => import("./components/DevDashboard.tsx"),
  });

  actions = $page({
    path: "/actions",
    label: "Actions",
    icon: <IconApi />,
    parent: this.layout,
    lazy: () => import("./components/actions/DevActionsExplorer.tsx"),
  });

  queues = $page({
    path: "/queues",
    label: "Queues",
    icon: <IconStack2 />,
    parent: this.layout,
    lazy: () => import("./components/DevQueueMonitor.tsx"),
  });

  topics = $page({
    path: "/topics",
    label: "Topics",
    icon: <IconMessageCircle />,
    parent: this.layout,
    lazy: () => import("./components/DevTopicsViewer.tsx"),
  });

  caches = $page({
    path: "/caches",
    label: "Caches",
    icon: <IconArchive />,
    parent: this.layout,
    lazy: () => import("./components/DevCacheInspector.tsx"),
  });

  env = $page({
    path: "/env",
    label: "Environment",
    icon: <IconVariable />,
    parent: this.layout,
    lazy: () => import("./components/DevEnvExplorer.tsx"),
  });

  atoms = $page({
    path: "/atoms",
    label: "Atoms",
    icon: <IconAtom />,
    parent: this.layout,
    lazy: () => import("./components/DevAtomsViewer.tsx"),
  });

  db = $page({
    path: "/db",
    label: "DB Studio",
    icon: <IconDatabase />,
    parent: this.layout,
    lazy: () => import("./components/db/DevDbStudio.tsx"),
  });

  graph = $page({
    path: "/graph",
    label: "Graph",
    icon: <IconTopologyRing />,
    parent: this.layout,
    lazy: () => import("./components/graph/DevDependencyGraph.tsx"),
  });
}
