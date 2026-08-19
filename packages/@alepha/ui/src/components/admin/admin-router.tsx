import type { AdminDashboardCard } from "@alepha/ui/components/admin/admin-dashboard-card";
import { AdminDashboardCountCard } from "@alepha/ui/components/admin/admin-dashboard-count-card";
import { $pageNav } from "@alepha/ui/components/nav-shell/nav-page";
import { $store, z } from "alepha";
import type { AdminAnalyticsController } from "alepha/api/analytics";
import type { AdminAuditController } from "alepha/api/audits";
import type { FileController } from "alepha/api/files";
import type { AdminJobController } from "alepha/api/jobs";
import type { AdminApiKeyController } from "alepha/api/keys";
import type { AdminNotificationController } from "alepha/api/notifications";
import type { AdminParameterController } from "alepha/api/parameters";
import type { AdminPaymentController } from "alepha/api/payments";
import type {
  AdminSessionController,
  AdminUserController,
} from "alepha/api/users";
import type { AdminWorkflowController } from "alepha/api/workflows";
import { $page } from "alepha/react/router";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";
import {
  Bell,
  ChartLine,
  CreditCard,
  Files,
  KeyRound,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UsersIcon,
  Workflow,
} from "lucide-react";
import { createElement } from "react";
import { adminRouterOptionsAtom } from "./admin-router-options.tsx";

/**
 * The whole `/admin` surface — twelve pages and their shell — mounted and wired.
 *
 * ⚠️ **Nav icons are `createElement(Icon)`, never `<Icon />`. Do not "fix"
 * them back to JSX.** This module is evaluated *eagerly* in the server graph:
 * `main.server.ts` → `$module` → `alepha.inject(AdminRouter)` runs these class
 * fields at import time, unlike every page below, which is behind `lazy()`.
 * `alepha db migrations create` imports that graph in a child process under
 * `tsx`, and `tsx` applies a single tsconfig resolved from the **cwd** — the
 * app root. A file outside that tsconfig's `include` (which this one is, being
 * in a sibling workspace) gets esbuild's defaults instead, and the default JSX
 * transform is the *classic* one. The emitted `React.createElement` then fails
 * with `ReferenceError: React is not defined`, breaking migration generation
 * for the whole app — with a stack that points here and explains none of this.
 *
 * ```ts
 * import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
 *
 * export const MyWeb = $module({
 *   name: "my.web",
 *   services: [MyRouter, AuthRouter, AdminRouter],
 * });
 * ```
 *
 * ### Every page is mounted; none is conditionally registered
 *
 * A page whose permission the signed-in admin does not hold hides itself, and
 * so does a page whose module is not registered — but through two separate
 * gates, not one. Each `$pageNav` here declares `permission`, and its `can`
 * calls a typed `$client` action, and the entry is hidden when either fails.
 *
 * `permission` alone cannot cover "the module is not registered": `$pageNav`
 * wires it into `use: [$secure({ permissions })]` on the page itself, and
 * `$secure` registers that permission into `SecurityProvider` eagerly, at
 * definition time — so the permission exists whether or not any controller
 * backing the page does, and an admin holding the `*` wildcard is granted it
 * regardless. `can` closes that gap with an action instead of a permission:
 * `this.userApi.findUsers.can()` is `LinkProvider.can("findUsers")` against
 * `/api/_links`, a registry built from the actions the server actually
 * registered, so an action nothing declared never appears there for anyone
 * to be granted. The action is read off a `$client<AdminUserController>()`
 * field, so a rename on the controller is a compile error here rather than a
 * silently dead sidebar entry — the failure mode a plain string name would
 * have.
 *
 * This is why there is no `pages: [...]` allowlist. A second gate on top of
 * two that already work goes stale: an application that later turns on
 * `features.audits` would still not see the Audits page until someone
 * remembered to edit the list.
 *
 * ### Extending the shell
 *
 * {@link $pageAdmin} (`@alepha/ui/components/admin/admin-router-page`) is the
 * way to add a page to this shell — the one-call form an application, or a
 * satellite package such as `@alepha/commerce/admin`, whose pages
 * deliberately live outside this design system so it never depends on a
 * domain, reaches for:
 *
 * ```tsx
 * class ShopAdminRouter {
 *   products = $pageAdmin({
 *     path: "/products",
 *     nav: { label: "Catalogue", group: "Commerce", order: 100 },
 *     lazy: () => import("./AdminProducts.tsx"),
 *   });
 * }
 * ```
 *
 * See `$pageAdmin`'s own JSDoc for the rules this composition must follow —
 * the `AdminRouter` registration it triggers, the `order` / `nav.group`
 * contract, and gating with `can` rather than `permission` alone.
 *
 * `layout` stays public as the seam underneath: `$pageAdmin` is exactly
 * `$inject(AdminRouter)` plus `parent: this.admin.layout`, done for you. An
 * application that wants that composition without going through `$pageAdmin`
 * — for instance to control itself whether and when `AdminRouter` gets
 * registered, rather than as an unconditional side effect of a field
 * initializer — injects `AdminRouter` and sets `parent: this.admin.layout`
 * directly, the same way `$pageAdmin` does internally.
 *
 * ### Group order is a contract
 *
 * The built-in pages are parked in a reserved high band: `Identity`
 * (1000-1003) and `System` (1010-1016). Everything below 1000 belongs to the
 * application, so a page declaring its own group at the conventional
 * `order: 100` sorts **above** the built-ins without having to ask — an
 * application's own domain outranks Users and Jobs. `useNavEntries` sorts
 * groups by their smallest member, so only an `order` of 1000 or more sinks a
 * page in among them.
 *
 * ### These thirteen route names are claimed globally
 *
 * `dashboard`, `users`, `userDetail`, `sessions`, `keys`, `jobs`,
 * `notifications`, `audits`, `files`, `parameters`, `payments`, `analytics`
 * and `workflows` each carry an explicit `name:` so a future rename of the
 * field itself (done for readability, without touching the string) never
 * silently changes the public route name — the same reason `AuthRouter`'s
 * pages all carry one too.
 *
 * Route names live in one process-wide namespace, and a duplicate does not
 * throw: `ReactPageProvider.page()` returns the first match. An adopter that
 * registers its own page named `files` (or any of the other ten) either
 * shadows this one or is shadowed by it, silently, depending on mount order.
 * Treat these eleven names as reserved when hanging pages off `layout`.
 */
export class AdminRouter {
  protected readonly options = $store(adminRouterOptionsAtom);

  protected readonly userApi = $client<AdminUserController>();
  protected readonly sessionApi = $client<AdminSessionController>();
  protected readonly apiKeyApi = $client<AdminApiKeyController>();
  protected readonly jobApi = $client<AdminJobController>();
  protected readonly notificationApi = $client<AdminNotificationController>();
  protected readonly auditApi = $client<AdminAuditController>();
  protected readonly fileApi = $client<FileController>();
  protected readonly parameterApi = $client<AdminParameterController>();
  protected readonly paymentApi = $client<AdminPaymentController>();
  protected readonly analyticsApi = $client<AdminAnalyticsController>();
  protected readonly workflowApi = $client<AdminWorkflowController>();

  /**
   * Anchors the shell and the first breadcrumb. Not itself a nav entry — a
   * shell root is excluded from its own sidebar.
   *
   * Named `admin` because `NavShell root="admin"` and `Spotlight root="admin"`
   * both resolve the subtree by this name.
   *
   * No index redirect: {@link dashboard} sits at `path: "/"`, so a bare
   * `/admin` resolves to it directly — the same arrangement `AccountRouter`
   * uses for `/account`. This used to throw a `Redirection` to an
   * `indexPath` option because the shell had no index child and something had
   * to choose a first page; the dashboard is that page, so both the hop and
   * the option are gone. An application that wants different content at
   * `/admin` contributes `dashboardCards` rather than redirecting away from
   * it.
   */
  layout = $page({
    name: "admin",
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    nav: { label: "Admin" },
    lazy: () => import("./admin-layout.tsx"),
  });

  /**
   * The landing page: `/admin` itself, and the only ungrouped entry.
   *
   * No `nav.group` plus `order: 0` puts it above every group without a
   * special case: `useNavEntries` keys groups by `nav.group ?? ""` and sorts
   * them by their smallest member, so the ungrouped bucket leads at 0 while
   * the built-ins sit at 1000+ and an application's own group conventionally
   * at 100.
   *
   * It declares no `permission` and no `can`. Reaching it already means
   * passing the layout's `admin:ui`, and it renders only the cards that pass
   * their own gate — so an administrator with nothing to see gets the empty
   * state rather than a locked door.
   */
  dashboard = $pageNav({
    parent: this.layout,
    path: "/",
    name: "dashboard",
    head: { title: "Dashboard" },
    nav: {
      label: "Dashboard",
      icon: createElement(LayoutDashboard),
      order: 0,
    },
    lazy: () => import("./admin-dashboard.tsx"),
    props: () => ({ cards: this.dashboardCards() }),
  });

  /**
   * Exactly one built-in card, then the application's.
   *
   * One is deliberate. The framework's job here is the contract, not the
   * content: `users` exists to show what a card looks like — gated on an
   * action so it disappears with its module, parked in the reserved 1000
   * band so an application's own cards lead — and nothing more. A dashboard
   * of framework tiles would decide what every admin's landing page says,
   * which is the application's call, and it would be the wrong call for most
   * of them: Sessions and Jobs are plumbing, not headlines.
   *
   * An application says what matters by contributing
   * `AdminRouterOptions.dashboardCards`; see `apps/examples/shop`, which adds
   * its catalogue and orders and so leads with them.
   */
  protected dashboardCards(): AdminDashboardCard[] {
    return [
      {
        id: "users",
        order: 1000,
        can: () => this.userApi.findUsers.can(),
        render: () =>
          createElement(AdminDashboardCountCard, {
            label: "Users",
            href: "/admin/users",
            icon: createElement(UsersIcon, { className: "size-4" }),
            load: async () =>
              (await this.userApi.findUsers({ query: { size: 1 } })).page
                .totalElements ?? 0,
          }),
      },
      ...(this.options.dashboardCards ?? []),
    ];
  }

  users = $pageNav({
    parent: this.layout,
    path: "/users",
    name: "users",
    head: { title: "Users" },
    permission: "admin:user:read",
    can: () => this.userApi.findUsers.can(),
    nav: {
      label: "Users",
      icon: createElement(UsersIcon),
      group: "Identity",
      order: 1000,
    },
    lazy: () => import("./admin-users.tsx"),
    props: () => this.options.pages?.users ?? {},
  });

  /**
   * No `nav` — a secured route that is not a sidebar entry. The breadcrumb
   * label falls back to `head.title`.
   */
  userDetail = $pageNav({
    parent: this.layout,
    path: "/users/:userId",
    name: "userDetail",
    head: { title: "User" },
    permission: "admin:user:read",
    can: () => this.userApi.getUser.can(),
    schema: {
      params: z.object({
        userId: z.uuid(),
      }),
    },
    lazy: () => import("./admin-user-detail.tsx"),
    props: () => this.options.pages?.userDetail ?? {},
  });

  sessions = $pageNav({
    parent: this.layout,
    path: "/sessions",
    name: "sessions",
    head: { title: "Sessions" },
    permission: "admin:session:read",
    can: () => this.sessionApi.findSessions.can(),
    nav: {
      label: "Sessions",
      icon: createElement(ShieldCheck),
      group: "Identity",
      order: 1001,
    },
    lazy: () => import("./admin-sessions.tsx"),
  });

  keys = $pageNav({
    parent: this.layout,
    path: "/keys",
    name: "keys",
    head: { title: "API keys" },
    permission: "admin:api-key:read",
    can: () => this.apiKeyApi.findApiKeys.can(),
    nav: {
      label: "API keys",
      icon: createElement(KeyRound),
      group: "Identity",
      order: 1003,
      keywords: ["tokens", "credentials"],
    },
    lazy: () => import("./admin-keys.tsx"),
  });

  jobs = $pageNav({
    parent: this.layout,
    path: "/jobs",
    name: "jobs",
    head: { title: "Jobs" },
    permission: "admin:job:read",
    can: () => this.jobApi.listJobs.can(),
    nav: {
      label: "Jobs",
      icon: createElement(Timer),
      group: "System",
      order: 1010,
    },
    lazy: () => import("./admin-jobs.tsx"),
  });

  notifications = $pageNav({
    parent: this.layout,
    path: "/notifications",
    name: "notifications",
    head: { title: "Notifications" },
    permission: "admin:notification:read",
    can: () => this.notificationApi.findNotifications.can(),
    nav: {
      label: "Notifications",
      icon: createElement(Bell),
      group: "System",
      order: 1011,
    },
    lazy: () => import("./admin-notifications.tsx"),
  });

  audits = $pageNav({
    parent: this.layout,
    path: "/audits",
    name: "audits",
    head: { title: "Audit log" },
    permission: "admin:audit:read",
    can: () => this.auditApi.findAudits.can(),
    nav: {
      label: "Audit log",
      icon: createElement(ShieldAlert),
      group: "Identity",
      order: 1002,
    },
    lazy: () => import("./admin-audits.tsx"),
  });

  files = $pageNav({
    parent: this.layout,
    path: "/files",
    name: "files",
    head: { title: "Files" },
    permission: "admin:file:read",
    can: () => this.fileApi.findFiles.can(),
    nav: {
      label: "Files",
      icon: createElement(Files),
      group: "System",
      order: 1012,
    },
    lazy: () => import("./admin-files.tsx"),
  });

  parameters = $pageNav({
    parent: this.layout,
    path: "/parameters",
    name: "parameters",
    head: { title: "Parameters" },
    permission: "admin:parameter:read",
    can: () => this.parameterApi.getParameterTree.can(),
    nav: {
      label: "Parameters",
      icon: createElement(SlidersHorizontal),
      group: "System",
      order: 1015,
      keywords: ["settings", "config", "configuration"],
    },
    lazy: () => import("./admin-parameters.tsx"),
    props: () => this.options.pages?.parameters ?? {},
  });

  /**
   * Both permissions are required, matching `AdminPaymentController`, which
   * gates every read with `["admin:payment:read", "payments:read"]` — and
   * `$pageNav` treats an array as AND, the same way `$secure` does.
   */
  payments = $pageNav({
    parent: this.layout,
    path: "/payments",
    name: "payments",
    head: { title: "Payments" },
    permission: ["admin:payment:read", "payments:read"],
    can: () => this.paymentApi.listIntents.can(),
    nav: {
      label: "Payments",
      icon: createElement(CreditCard),
      group: "System",
      order: 1013,
    },
    lazy: () => import("./admin-payments.tsx"),
  });

  analytics = $pageNav({
    parent: this.layout,
    path: "/analytics",
    name: "analytics",
    head: { title: "Analytics" },
    permission: "admin:analytics:read",
    can: () => this.analyticsApi.listDatasets.can(),
    nav: {
      label: "Analytics",
      icon: createElement(ChartLine),
      group: "System",
      order: 1016,
    },
    lazy: () => import("./admin-analytics.tsx"),
  });

  workflows = $pageNav({
    parent: this.layout,
    path: "/workflows",
    name: "workflows",
    head: { title: "Workflows" },
    permission: "admin:workflow:read",
    can: () => this.workflowApi.getWorkflowRegistry.can(),
    nav: {
      label: "Workflows",
      icon: createElement(Workflow),
      group: "System",
      order: 1014,
      keywords: ["saga", "steps", "executions"],
    },
    lazy: () => import("./admin-workflows.tsx"),
  });
}
