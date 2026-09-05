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
      this.controlText,
      this.controlNumber,
      this.controlDate,
      this.controlSelect,
      this.autoFormBasic,
      this.autoFormObject,
      this.autoFormArray,
      this.blocksTable,
      this.blocksDialog,
      this.blocksToast,
      this.blocksButtons,
      this.authLogin,
      this.authRegister,
      this.authReset,
      this.authVerify,
      this.authMfa,
      this.accountProfile,
      this.accountSecurity,
      this.accountSessions,
      this.accountKeys,
      this.accountConnections,
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

  /**
   * What the viewport iframe loads. See `PreviewFrame` for why an iframe.
   *
   * ⚠️ Deliberately OUTSIDE `layout.children`, which is what makes it render
   * with no shell - the parent already drew one, and a second inside the frame
   * is the thing being avoided. It mounts its own providers instead.
   *
   * ⚠️ Deliberately NOT `static`. Its rendering depends on `?p=`, and a
   * prerendered copy is built with no query string: hydration would find a
   * different page than the HTML it was given and re-render from scratch.
   */
  preview = $page({
    path: "/preview",
    head: { title: "Preview - Alepha UI" },
    lazy: () => import("./pages/PreviewFrame.tsx"),
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

  /**
   * `Control` is four pages and `AutoForm` three, because each is a subject
   * rather than a variant: a reader looking for the date picker should not
   * have to find it behind a dropdown on a page called Controls.
   */
  controlText = $page({
    path: "/blocks/control/text",
    static: true,
    head: { title: "Text - Alepha UI" },
    lazy: () => import("./pages/blocks/control/Text.tsx"),
  });

  controlNumber = $page({
    path: "/blocks/control/number",
    static: true,
    head: { title: "Number - Alepha UI" },
    lazy: () => import("./pages/blocks/control/Number.tsx"),
  });

  controlDate = $page({
    path: "/blocks/control/date",
    static: true,
    head: { title: "Date - Alepha UI" },
    lazy: () => import("./pages/blocks/control/Date.tsx"),
  });

  controlSelect = $page({
    path: "/blocks/control/select",
    static: true,
    head: { title: "Select - Alepha UI" },
    lazy: () => import("./pages/blocks/control/Select.tsx"),
  });

  autoFormBasic = $page({
    path: "/blocks/auto-form/basic",
    static: true,
    head: { title: "AutoForm - Alepha UI" },
    lazy: () => import("./pages/blocks/auto-form/Basic.tsx"),
  });

  autoFormObject = $page({
    path: "/blocks/auto-form/object",
    static: true,
    head: { title: "AutoForm objects - Alepha UI" },
    lazy: () => import("./pages/blocks/auto-form/Object.tsx"),
  });

  autoFormArray = $page({
    path: "/blocks/auto-form/array",
    static: true,
    head: { title: "AutoForm arrays - Alepha UI" },
    lazy: () => import("./pages/blocks/auto-form/Array.tsx"),
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

  /**
   * One page per screen rather than one page with a `screen` knob.
   *
   * These are PAGES an application routes to, not variants of one component:
   * `/login` and `/register` are separate destinations with separate titles in
   * every app that mounts them, and collapsing them into a dropdown made the
   * showcase misrepresent the thing it documents. It also made four of the five
   * unlinkable.
   */
  authLogin = $page({
    path: "/pages/auth/login",
    static: true,
    head: { title: "Sign in - Alepha UI" },
    lazy: () => import("./pages/pages/auth/Login.tsx"),
  });

  authRegister = $page({
    path: "/pages/auth/register",
    static: true,
    head: { title: "Register - Alepha UI" },
    lazy: () => import("./pages/pages/auth/Register.tsx"),
  });

  authReset = $page({
    path: "/pages/auth/reset",
    static: true,
    head: { title: "Reset password - Alepha UI" },
    lazy: () => import("./pages/pages/auth/ResetPassword.tsx"),
  });

  authVerify = $page({
    path: "/pages/auth/verify",
    static: true,
    head: { title: "Verify email - Alepha UI" },
    lazy: () => import("./pages/pages/auth/VerifyEmail.tsx"),
  });

  authMfa = $page({
    path: "/pages/auth/mfa",
    static: true,
    head: { title: "Second factor - Alepha UI" },
    lazy: () => import("./pages/pages/auth/Mfa.tsx"),
  });

  accountProfile = $page({
    path: "/pages/account/profile",
    static: true,
    head: { title: "Profile - Alepha UI" },
    lazy: () => import("./pages/pages/account/Profile.tsx"),
  });

  accountSecurity = $page({
    path: "/pages/account/security",
    static: true,
    head: { title: "Security - Alepha UI" },
    lazy: () => import("./pages/pages/account/Security.tsx"),
  });

  accountSessions = $page({
    path: "/pages/account/sessions",
    static: true,
    head: { title: "Account sessions - Alepha UI" },
    lazy: () => import("./pages/pages/account/Sessions.tsx"),
  });

  accountKeys = $page({
    path: "/pages/account/keys",
    static: true,
    head: { title: "Account API keys - Alepha UI" },
    lazy: () => import("./pages/pages/account/Keys.tsx"),
  });

  accountConnections = $page({
    path: "/pages/account/connections",
    static: true,
    head: { title: "Connections - Alepha UI" },
    lazy: () => import("./pages/pages/account/Connections.tsx"),
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
