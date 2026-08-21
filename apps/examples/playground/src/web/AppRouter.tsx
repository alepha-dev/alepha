import { $page } from "alepha/react/router";
import { Layout } from "./Layout.tsx";

/**
 * AppRouter — every leaf page is loaded via `lazy: () => import(…)` so each
 * route is its own code-split chunk. `Layout` stays eager because it's the
 * long-lived shell.
 */
export class AppRouter {
  // ── Public shell: /, demo/*, playgrounds/* ───────────────────────────
  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.playgroundJobs,
      this.playgroundNotifications,
      this.playgroundAudits,
      this.demoSegmented,
      this.demoTables,
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
  //
  // Not declared here: `AuthRouter` from `@alepha/ui` mounts all four screens
  // at exactly these paths, and `PlaygroundWeb` registers it as a service.
  //
  // The four pages this replaced were pass-through wrappers — each rendered one
  // `@alepha/ui` component with the realm config and nothing else, and passed no
  // path props at all, so every cross-link relied on the components' `/auth/*`
  // fallbacks. Those fallbacks are precisely what this router makes explicit.

  // ── /admin/* ─────────────────────────────────────────────────────────
  //
  // Not declared here: `AdminRouter` from `@alepha/ui` mounts the whole
  // `/admin` surface, and `PlaygroundWeb` registers it as a service.
  //
  // The eight pages this replaced were pass-through wrappers — each rendered
  // one `@alepha/ui` component and nothing else, which is exactly what the
  // shared router's own pages already are.

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

  demoTables = $page({
    path: "/demo/tables",
    head: { title: "Table demo" },
    lazy: () => import("./pages/demo/Tables.tsx"),
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
