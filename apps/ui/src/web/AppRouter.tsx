import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Two subjects: `/blocks/*` for the components a page is built from, and
 * `/pages/*` for the pages built out of them.
 *
 * Every leaf is `lazy` so each is its own chunk, and `static` so the build
 * prerenders it. A prerendered page is served off Cloudflare's asset manifest
 * without invoking the worker at all.
 */
export class AppRouter {
  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.blocksShell,
      this.blocksSidebar,
      this.blocksControls,
      this.blocksSelect,
      this.blocksAutoForm,
      this.blocksTable,
      this.blocksDialog,
      this.blocksToast,
      this.blocksButtons,
      this.pagesAuth,
      this.pagesAccount,
      this.adminDashboard,
      this.adminUsers,
      this.adminUserDetail,
      this.adminSessions,
      this.adminKeys,
      this.adminJobs,
      this.adminFiles,
      this.adminNotifications,
      this.adminParameters,
      this.adminAnalytics,
      this.adminPayments,
      this.adminAudits,
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

  // ── Blocks ───────────────────────────────────────────────────────────────

  blocksShell = $page({
    path: "/blocks/shell",
    static: true,
    head: { title: "App shell - Alepha UI" },
    lazy: () => import("./pages/blocks/Shell.tsx"),
  });

  blocksSidebar = $page({
    path: "/blocks/sidebar",
    static: true,
    head: { title: "Sidebar - Alepha UI" },
    lazy: () => import("./pages/blocks/SidebarPage.tsx"),
  });

  blocksControls = $page({
    path: "/blocks/controls",
    static: true,
    head: { title: "Controls - Alepha UI" },
    lazy: () => import("./pages/blocks/Controls.tsx"),
  });

  blocksSelect = $page({
    path: "/blocks/select",
    static: true,
    head: { title: "Select - Alepha UI" },
    lazy: () => import("./pages/blocks/Select.tsx"),
  });

  blocksAutoForm = $page({
    path: "/blocks/auto-form",
    static: true,
    head: { title: "AutoForm - Alepha UI" },
    lazy: () => import("./pages/blocks/AutoFormBlock.tsx"),
  });

  blocksTable = $page({
    path: "/blocks/table",
    static: true,
    head: { title: "Table - Alepha UI" },
    lazy: () => import("./pages/blocks/Table.tsx"),
  });

  blocksDialog = $page({
    path: "/blocks/dialog",
    static: true,
    head: { title: "Dialog - Alepha UI" },
    lazy: () => import("./pages/blocks/Dialog.tsx"),
  });

  blocksToast = $page({
    path: "/blocks/toast",
    static: true,
    head: { title: "Toast - Alepha UI" },
    lazy: () => import("./pages/blocks/Toast.tsx"),
  });

  blocksButtons = $page({
    path: "/blocks/buttons",
    static: true,
    head: { title: "Buttons - Alepha UI" },
    lazy: () => import("./pages/blocks/Buttons.tsx"),
  });

  // ── Pages ────────────────────────────────────────────────────────────────

  pagesAuth = $page({
    path: "/pages/auth",
    static: true,
    head: { title: "Auth - Alepha UI" },
    lazy: () => import("./pages/pages/Auth.tsx"),
  });

  pagesAccount = $page({
    path: "/pages/account",
    static: true,
    head: { title: "Account - Alepha UI" },
    lazy: () => import("./pages/pages/Account.tsx"),
  });

  adminDashboard = $page({
    path: "/pages/admin/dashboard",
    static: true,
    head: { title: "Admin dashboard - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Dashboard.tsx"),
  });

  adminUsers = $page({
    path: "/pages/admin/users",
    static: true,
    head: { title: "Admin users - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Users.tsx"),
  });

  /**
   * ⚠️ NOT under `/pages`. `AdminUsers` navigates to this exact path with a
   * hardcoded push, so anything else leaves every row linking to a 404.
   *
   * Not `static`: the id is a route param, so there is no fixed set of pages
   * to prerender.
   */
  adminUserDetail = $page({
    path: "/admin/users/:userId",
    head: { title: "User - Alepha UI" },
    lazy: () => import("./pages/pages/admin/UserDetail.tsx"),
  });

  adminSessions = $page({
    path: "/pages/admin/sessions",
    static: true,
    head: { title: "Admin sessions - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Sessions.tsx"),
  });

  adminKeys = $page({
    path: "/pages/admin/keys",
    static: true,
    head: { title: "Admin API keys - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Keys.tsx"),
  });

  adminJobs = $page({
    path: "/pages/admin/jobs",
    static: true,
    head: { title: "Admin jobs - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Jobs.tsx"),
  });

  adminFiles = $page({
    path: "/pages/admin/files",
    static: true,
    head: { title: "Admin files - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Files.tsx"),
  });

  adminNotifications = $page({
    path: "/pages/admin/notifications",
    static: true,
    head: { title: "Admin notifications - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Notifications.tsx"),
  });

  adminParameters = $page({
    path: "/pages/admin/parameters",
    static: true,
    head: { title: "Admin parameters - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Parameters.tsx"),
  });

  adminAnalytics = $page({
    path: "/pages/admin/analytics",
    static: true,
    head: { title: "Admin analytics - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Analytics.tsx"),
  });

  adminPayments = $page({
    path: "/pages/admin/payments",
    static: true,
    head: { title: "Admin payments - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Payments.tsx"),
  });

  adminAudits = $page({
    path: "/pages/admin/audits",
    static: true,
    head: { title: "Admin audit log - Alepha UI" },
    lazy: () => import("./pages/pages/admin/Audits.tsx"),
  });
}
