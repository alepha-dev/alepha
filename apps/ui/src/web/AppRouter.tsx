import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Every leaf page is `lazy` so each is its own chunk, and every leaf page is
 * `static` so the build prerenders it.
 *
 * `static` is what keeps this site free to run: a prerendered page is served
 * off Cloudflare's asset manifest without invoking the worker at all. Combined
 * with `run_worker_first: ["/api/*"]` in `alepha.config.ts`, the worker exists
 * for sigil ingest and nothing else.
 */
export class AppRouter {
  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.primitives,
      this.blocksTable,
      this.blocksControls,
      this.blocksAutoForm,
      this.blocksFeedback,
      this.blocksButtons,
      this.adminUsers,
      this.adminAudits,
      this.adminJobs,
      this.adminSessions,
      this.adminKeys,
      this.adminFiles,
      this.adminNotifications,
      this.adminParameters,
      this.adminDashboard,
      this.adminAnalytics,
    ],
  });

  home = $page({
    path: "/",
    static: true,
    head: {
      title: "Alepha UI",
      description:
        "Every component in @alepha/ui, rendered with its variants, on one site.",
    },
    lazy: () => import("./pages/Home.tsx"),
  });

  primitives = $page({
    path: "/primitives",
    static: true,
    head: { title: "Primitives - Alepha UI" },
    lazy: () => import("./pages/Primitives.tsx"),
  });

  blocksTable = $page({
    path: "/blocks/table",
    static: true,
    head: { title: "AlephaTable - Alepha UI" },
    lazy: () => import("./pages/blocks/Table.tsx"),
  });

  blocksControls = $page({
    path: "/blocks/controls",
    static: true,
    head: { title: "Controls - Alepha UI" },
    lazy: () => import("./pages/blocks/Controls.tsx"),
  });

  blocksAutoForm = $page({
    path: "/blocks/auto-form",
    static: true,
    head: { title: "AutoForm - Alepha UI" },
    lazy: () => import("./pages/blocks/AutoFormBlock.tsx"),
  });

  blocksFeedback = $page({
    path: "/blocks/feedback",
    static: true,
    head: { title: "Toasts and dialogs - Alepha UI" },
    lazy: () => import("./pages/blocks/Feedback.tsx"),
  });

  adminDashboard = $page({
    path: "/blocks/admin/dashboard",
    static: true,
    head: { title: "Admin dashboard - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Dashboard.tsx"),
  });

  adminUsers = $page({
    path: "/blocks/admin/users",
    static: true,
    head: { title: "Admin users - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Users.tsx"),
  });

  adminSessions = $page({
    path: "/blocks/admin/sessions",
    static: true,
    head: { title: "Admin sessions - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Sessions.tsx"),
  });

  adminKeys = $page({
    path: "/blocks/admin/keys",
    static: true,
    head: { title: "Admin api keys - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Keys.tsx"),
  });

  adminFiles = $page({
    path: "/blocks/admin/files",
    static: true,
    head: { title: "Admin files - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Files.tsx"),
  });

  adminNotifications = $page({
    path: "/blocks/admin/notifications",
    static: true,
    head: { title: "Admin notifications - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Notifications.tsx"),
  });

  adminParameters = $page({
    path: "/blocks/admin/parameters",
    static: true,
    head: { title: "Admin parameters - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Parameters.tsx"),
  });

  adminAnalytics = $page({
    path: "/blocks/admin/analytics",
    static: true,
    head: { title: "Admin analytics - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Analytics.tsx"),
  });

  adminJobs = $page({
    path: "/blocks/admin/jobs",
    static: true,
    head: { title: "Admin jobs - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Jobs.tsx"),
  });

  adminAudits = $page({
    path: "/blocks/admin/audits",
    static: true,
    head: { title: "Admin audit log - Alepha UI" },
    lazy: () => import("./pages/blocks/admin/Audits.tsx"),
  });

  blocksButtons = $page({
    path: "/blocks/buttons",
    static: true,
    head: { title: "Buttons - Alepha UI" },
    lazy: () => import("./pages/blocks/Buttons.tsx"),
  });
}
