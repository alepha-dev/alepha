import { $page } from "alepha/react/router";

export class AppRouter {
  layout = $page({
    path: "/",
    lazy: () => import("./components/DevLayout.tsx"),
  });

  dashboard = $page({
    path: "/",
    label: "Dashboard",
    parent: this.layout,
    lazy: () => import("./components/dashboard/DevDashboard.tsx"),
  });

  explorer = $page({
    path: "/explorer",
    label: "Explorer",
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
    parent: this.db,
    lazy: () => import("./components/database/DatabaseErd.page.tsx"),
  });

  dbEditor = $page({
    path: "/editor",
    label: "Database",
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
    parent: this.conf,
    lazy: () => import("./components/configuration/ConfigEnv.page.tsx"),
  });

  confAtoms = $page({
    path: "/atoms",
    label: "Configuration",
    parent: this.conf,
    lazy: () => import("./components/configuration/ConfigAtoms.page.tsx"),
  });

  graph = $page({
    path: "/graph",
    label: "Graph",
    parent: this.layout,
    lazy: () => import("./components/graph/DevDependencyGraph.tsx"),
  });

  emails = $page({
    path: "/emails",
    label: "Emails",
    parent: this.layout,
    lazy: () => import("./components/emails/DevEmails.tsx"),
  });

  sms = $page({
    path: "/sms",
    label: "SMS",
    parent: this.layout,
    lazy: () => import("./components/sms/DevSms.tsx"),
  });

  logs = $page({
    path: "/logs",
    label: "Logs",
    parent: this.layout,
    lazy: () => import("./components/logs/DevLogs.tsx"),
  });
}
