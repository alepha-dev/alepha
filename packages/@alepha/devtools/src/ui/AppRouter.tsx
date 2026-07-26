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

  // Declared primitives -----------------------------------------------------

  actions = $page({
    path: "/actions",
    label: "Actions",
    parent: this.layout,
    lazy: () => import("./components/actions/DevActions.tsx"),
  });

  pages = $page({
    path: "/pages",
    label: "Pages",
    parent: this.layout,
    lazy: () => import("./components/declared/DevPages.tsx"),
  });

  jobs = $page({
    path: "/jobs",
    label: "Jobs",
    parent: this.layout,
    lazy: () => import("./components/jobs/DevJobs.tsx"),
  });

  topics = $page({
    path: "/topics",
    label: "Topics",
    parent: this.layout,
    lazy: () => import("./components/declared/DevTopics.tsx"),
  });

  caches = $page({
    path: "/caches",
    label: "Caches",
    parent: this.layout,
    lazy: () => import("./components/declared/DevCaches.tsx"),
  });

  storages = $page({
    path: "/storages",
    label: "Storages",
    parent: this.layout,
    lazy: () => import("./components/declared/DevStorages.tsx"),
  });

  realms = $page({
    path: "/realms",
    label: "Realms",
    parent: this.layout,
    lazy: () => import("./components/declared/DevRealms.tsx"),
  });

  // Data --------------------------------------------------------------------
  //
  // Flat, one route per nav entry. These used to sit under `/db` and `/conf`
  // parents that existed only to host a tab bar duplicating the sidebar — and
  // sharing a first path segment also made both siblings match the nav's
  // active check at once.

  schema = $page({
    path: "/schema",
    label: "Schema",
    parent: this.layout,
    lazy: () => import("./components/database/DatabaseErd.page.tsx"),
  });

  rows = $page({
    path: "/rows",
    label: "Rows",
    parent: this.layout,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  rowsTable = $page({
    path: "/rows/:table",
    parent: this.layout,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  rowsRecord = $page({
    path: "/rows/:table/:id",
    parent: this.layout,
    lazy: () => import("./components/database/DatabaseEditor.page.tsx"),
  });

  // Config ------------------------------------------------------------------

  env = $page({
    path: "/env",
    label: "Environment",
    parent: this.layout,
    lazy: () => import("./components/config/DevEnvironment.tsx"),
  });

  state = $page({
    path: "/state",
    label: "State",
    parent: this.layout,
    lazy: () => import("./components/config/DevState.tsx"),
  });

  // Diagnostics -------------------------------------------------------------

  graph = $page({
    path: "/graph",
    label: "Graph",
    parent: this.layout,
    lazy: () => import("./components/graph/DevDependencyGraph.tsx"),
  });

  outbox = $page({
    path: "/outbox",
    label: "Outbox",
    parent: this.layout,
    lazy: () => import("./components/outbox/DevOutbox.tsx"),
  });

  logs = $page({
    path: "/logs",
    label: "Logs",
    parent: this.layout,
    lazy: () => import("./components/logs/DevLogs.tsx"),
  });
}
