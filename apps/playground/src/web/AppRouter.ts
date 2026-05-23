import type { RealmController } from "alepha/api/users";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";
import { AdminLayout } from "./AdminLayout.tsx";
import { AuthLayout } from "./AuthLayout.tsx";
import { Layout } from "./Layout.tsx";

/**
 * AppRouter — every leaf page is loaded via `lazy: () => import(…)` so each
 * route is its own code-split chunk. The 3 layouts (Layout, AdminLayout,
 * AuthLayout) stay eager because they're the long-lived shells.
 */
export class AppRouter {
  realmApi = $client<RealmController>();

  // ── Public shell: /, demo/*, playgrounds/* ───────────────────────────
  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.playgroundJobs,
      this.playgroundNotifications,
      this.playgroundAudits,
      this.demoSegmented,
      this.demoToasts,
      this.demoDialogs,
      this.demoAutoForm,
      this.demoForms,
      this.demoFormsLogin,
      this.demoFormsRegister,
      this.demoFormsAddress,
      this.demoFormsPayment,
      this.demoFormsSelects,
      this.demoFormsUpload,
      this.demoFormsDates,
    ],
  });

  home = $page({
    path: "/",
    head: { title: "Alepha Playground" },
    lazy: () => import("./pages/Home.tsx"),
  });

  // ── /auth/* ──────────────────────────────────────────────────────────
  authLayout = $page({
    path: "/auth",
    component: AuthLayout,
    children: (): any[] => [
      this.authLogin,
      this.authRegister,
      this.authReset,
      this.authVerify,
    ],
  });

  authLogin = $page({
    path: "/login",
    name: "login",
    head: { title: "Sign in" },
    lazy: () => import("./pages/auth/Login.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
  });

  authRegister = $page({
    path: "/register",
    name: "register",
    head: { title: "Sign up" },
    lazy: () => import("./pages/auth/Register.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
  });

  authReset = $page({
    path: "/reset-password",
    head: { title: "Reset password" },
    lazy: () => import("./pages/auth/ResetPassword.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
  });

  authVerify = $page({
    path: "/verify-email",
    head: { title: "Verify email" },
    lazy: () => import("./pages/auth/VerifyEmail.tsx"),
  });

  // ── /admin/* — gated by `admin:ui` ───────────────────────────────────
  adminLayout = $page({
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    component: AdminLayout,
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    children: (): any[] => [
      this.adminUsers,
      this.adminSessions,
      this.adminKeys,
      this.adminJobs,
      this.adminAudits,
      this.adminNotifications,
      this.adminFiles,
      this.adminParameters,
    ],
  });

  adminUsers = $page({
    path: "/users",
    head: { title: "Users" },
    lazy: () => import("./pages/admin/Users.tsx"),
  });

  adminSessions = $page({
    path: "/sessions",
    head: { title: "Sessions" },
    lazy: () => import("./pages/admin/Sessions.tsx"),
  });

  adminKeys = $page({
    path: "/keys",
    head: { title: "API keys" },
    lazy: () => import("./pages/admin/Keys.tsx"),
  });

  adminJobs = $page({
    path: "/jobs",
    head: { title: "Jobs" },
    lazy: () => import("./pages/admin/Jobs.tsx"),
  });

  adminAudits = $page({
    path: "/audits",
    head: { title: "Audit log" },
    lazy: () => import("./pages/admin/Audits.tsx"),
  });

  adminNotifications = $page({
    path: "/notifications",
    head: { title: "Notifications" },
    lazy: () => import("./pages/admin/Notifications.tsx"),
  });

  adminFiles = $page({
    path: "/files",
    head: { title: "Files" },
    lazy: () => import("./pages/admin/Files.tsx"),
  });

  adminParameters = $page({
    path: "/parameters",
    head: { title: "Parameters" },
    lazy: () => import("./pages/admin/Parameters.tsx"),
  });

  // ── Playgrounds + Demo ───────────────────────────────────────────────
  playgroundJobs = $page({
    path: "/playgrounds/jobs",
    head: { title: "Jobs playground" },
    lazy: () => import("./pages/playgrounds/Jobs.tsx"),
  });

  playgroundNotifications = $page({
    path: "/playgrounds/notifications",
    head: { title: "Notifications playground" },
    lazy: () => import("./pages/playgrounds/Notifications.tsx"),
  });

  playgroundAudits = $page({
    path: "/playgrounds/audits",
    head: { title: "Audits playground" },
    lazy: () => import("./pages/playgrounds/Audits.tsx"),
  });

  demoSegmented = $page({
    path: "/demo/segmented",
    head: { title: "Segmented demo" },
    lazy: () => import("./pages/demo/Segmented.tsx"),
  });

  demoToasts = $page({
    path: "/demo/toasts",
    head: { title: "Toasts demo" },
    lazy: () => import("./pages/demo/Toasts.tsx"),
  });

  demoDialogs = $page({
    path: "/demo/dialogs",
    head: { title: "Dialogs demo" },
    lazy: () => import("./pages/demo/Dialogs.tsx"),
  });

  demoAutoForm = $page({
    path: "/demo/auto-form",
    head: { title: "AutoForm demo" },
    lazy: () => import("./pages/demo/AutoForm.tsx"),
  });

  demoForms = $page({
    path: "/demo/forms",
    head: { title: "Forms gallery" },
    lazy: () => import("./pages/demo/forms/Forms.tsx"),
  });

  demoFormsLogin = $page({
    path: "/demo/forms/login",
    head: { title: "Login form" },
    lazy: () => import("./pages/demo/forms/Login.tsx"),
  });

  demoFormsRegister = $page({
    path: "/demo/forms/register",
    head: { title: "Register form" },
    lazy: () => import("./pages/demo/forms/Register.tsx"),
  });

  demoFormsAddress = $page({
    path: "/demo/forms/address",
    head: { title: "Address form" },
    lazy: () => import("./pages/demo/forms/Address.tsx"),
  });

  demoFormsPayment = $page({
    path: "/demo/forms/payment",
    head: { title: "Payment form" },
    lazy: () => import("./pages/demo/forms/Payment.tsx"),
  });

  demoFormsSelects = $page({
    path: "/demo/forms/selects",
    head: { title: "Select variants" },
    lazy: () => import("./pages/demo/forms/Selects.tsx"),
  });

  demoFormsUpload = $page({
    path: "/demo/forms/upload",
    head: { title: "File upload" },
    lazy: () => import("./pages/demo/forms/Upload.tsx"),
  });

  demoFormsDates = $page({
    path: "/demo/forms/dates",
    head: { title: "Date / time" },
    lazy: () => import("./pages/demo/forms/Dates.tsx"),
  });
}
