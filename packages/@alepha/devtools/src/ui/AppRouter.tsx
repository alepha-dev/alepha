import { $ui, midnightTheme } from "@alepha/mantine";
import {
  IconDashboard,
  IconDatabase,
  IconList,
  IconMail,
  IconMessage,
  IconSettings,
  IconSitemap,
  IconTopologyRing,
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
    lazy: () => import("./components/dashboard/DevDashboard.tsx"),
  });

  explorer = $page({
    path: "/explorer",
    label: "Explorer",
    icon: <IconSitemap />,
    parent: this.layout,
    lazy: () => import("./components/explorer/DevExplorer.tsx"),
  });

  // Database parent (tabs + NestedView)
  db = $page({
    path: "/db",
    parent: this.layout,
    lazy: () => import("./components/database/DevDatabase.tsx"),
  });

  dbErd = $page({
    path: "/erd",
    label: "Database",
    icon: <IconDatabase />,
    parent: this.db,
    lazy: () => import("./components/database/DatabaseErd.page.tsx"),
  });

  dbEditor = $page({
    path: "/editor",
    label: "Database",
    icon: <IconDatabase />,
    parent: this.db,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  dbEditorTable = $page({
    path: "/editor/:table",
    parent: this.db,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  dbEditorRecord = $page({
    path: "/editor/:table/:id",
    parent: this.db,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  // Configuration parent (tabs + NestedView)
  conf = $page({
    path: "/conf",
    parent: this.layout,
    lazy: () => import("./components/configuration/DevConfiguration.tsx"),
  });

  confEnv = $page({
    path: "/env",
    label: "Configuration",
    icon: <IconSettings />,
    parent: this.conf,
    lazy: () => import("./components/configuration/ConfigEnv.page.tsx"),
  });

  confAtoms = $page({
    path: "/atoms",
    label: "Configuration",
    icon: <IconSettings />,
    parent: this.conf,
    lazy: () => import("./components/configuration/ConfigAtoms.page.tsx"),
  });

  graph = $page({
    path: "/graph",
    label: "Graph",
    icon: <IconTopologyRing />,
    parent: this.layout,
    lazy: () => import("./components/graph/DevDependencyGraph.tsx"),
  });

  emails = $page({
    path: "/emails",
    label: "Emails",
    icon: <IconMail />,
    parent: this.layout,
    lazy: () => import("./components/emails/DevEmails.tsx"),
  });

  sms = $page({
    path: "/sms",
    label: "SMS",
    icon: <IconMessage />,
    parent: this.layout,
    lazy: () => import("./components/sms/DevSms.tsx"),
  });

  logs = $page({
    path: "/logs",
    label: "Logs",
    icon: <IconList />,
    parent: this.layout,
    lazy: () => import("./components/logs/DevLogs.tsx"),
  });
}
