import { z } from "alepha";
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
    path: "/storage",
    label: "Storage",
    parent: this.layout,
    lazy: () => import("./components/declared/DevStorages.tsx"),
  });

  realms = $page({
    path: "/realms",
    label: "Realms",
    parent: this.layout,
    lazy: () => import("./components/declared/DevRealms.tsx"),
  });

  roles = $page({
    path: "/roles",
    label: "Roles",
    parent: this.layout,
    lazy: () => import("./components/security/DevRoles.tsx"),
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

  // Three routes, nested rather than siblings (#Q2351). Since #Q2349 a page
  // remounts when its path identity changes, so three sibling routes sharing
  // one editor remounted it on every step: opening a row reloaded the grid,
  // cleared the selection, reset the rail's filter and scroll, and refetched
  // a count for every table. What must survive a step lives in the layer
  // above it: the rail in `rows`, which no table changes, and the grid in
  // `rowsTable`, which opening one of its records does not change.
  //
  // Each route still declares the params it actually has, so `table` and `id`
  // are typed and decoded and the routes can be named in a `router.push`.
  rows = $page({
    path: "/rows",
    label: "Rows",
    parent: this.layout,
    lazy: () => import("./components/database/DatabaseRows.page.tsx"),
  });

  rowsTable = $page({
    path: "/:table",
    parent: this.rows,
    schema: { params: z.object({ table: z.text() }) },
    loader: ({ params }) => ({ table: params.table }),
    lazy: () => import("./components/database/DatabaseTable.page.tsx"),
  });

  rowsRecord = $page({
    path: "/:id",
    parent: this.rowsTable,
    schema: { params: z.object({ table: z.text(), id: z.text() }) },
    loader: ({ params }) => ({ table: params.table, recordId: params.id }),
    lazy: () => import("./components/database/DatabaseRecord.page.tsx"),
  });

  // Config ------------------------------------------------------------------

  env = $page({
    path: "/env",
    label: "Environment",
    parent: this.layout,
    lazy: () => import("./components/config/DevEnvironment.tsx"),
  });

  atoms = $page({
    path: "/atoms",
    label: "Atoms",
    parent: this.layout,
    lazy: () => import("./components/config/DevAtoms.tsx"),
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
