import { navPage } from "@alepha/ui/components/nav-shell/nav-page";
import { $store, z } from "alepha";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import {
  Bell,
  CreditCard,
  Files,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UsersIcon,
} from "lucide-react";
import AdminLayout from "./admin-layout.tsx";
import { adminRouterOptionsAtom } from "./admin-router-options.ts";

/**
 * The whole `/admin` surface — ten pages and their shell — mounted and wired.
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
 * A page whose module is not registered hides itself, and so does a page whose
 * permission the signed-in admin does not hold — both through one mechanism.
 * `useAuth().has()` resolves via `LinkProvider.can()`, backed by `/api/_links`,
 * a registry the server prunes per caller. `$secure({ permissions: [...] })` is
 * what *declares* a permission, so an unregistered controller declares nothing;
 * and `SecurityProvider.getPermissions()` expands the `*` wildcard against the
 * container's live registry rather than a static list, so not even an
 * all-permissions admin is granted something nothing declared.
 *
 * This is why there is no `pages: [...]` allowlist. A second gate on top of one
 * that already works goes stale: an application that later turns on
 * `features.audits` would still not see the Audits page until someone
 * remembered to edit the list.
 *
 * ### Extending the shell
 *
 * `layout` is public on purpose. An application — or a satellite package such
 * as `@alepha/commerce/admin`, whose pages deliberately live outside this
 * design system so it never depends on a domain — hangs its own pages off it:
 *
 * ```tsx
 * class ShopAdminRouter {
 *   protected readonly admin = $inject(AdminRouter);
 *
 *   products = $page({
 *     parent: this.admin.layout,
 *     path: "/products",
 *     nav: { label: "Catalogue", group: "Commerce", order: 100 },
 *     lazy: () => import("./AdminProducts.tsx"),
 *   });
 * }
 * ```
 *
 * The sidebar entry needs no registration: `useNavEntries` walks the parent
 * chain and reads each page's own `nav`.
 *
 * ### Group order is a contract
 *
 * The built-in pages occupy `Identity` (orders 1-3) and `Operations`
 * (orders 4-9). An application's page should either join one of those with an
 * `order` of 100 or more, or declare a group of its own. `useNavEntries` sorts
 * groups by their smallest member, so a custom page at `order: 2` would
 * silently reshuffle the built-in sidebar.
 */
export class AdminRouter {
  protected readonly options = $store(adminRouterOptionsAtom);

  /**
   * Anchors the shell and the first breadcrumb. Not itself a nav entry — a
   * shell root is excluded from its own sidebar.
   *
   * Named `admin` because `NavShell root="admin"` and `Spotlight root="admin"`
   * both resolve the subtree by this name.
   */
  layout = $page({
    name: "admin",
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    nav: { label: "Admin" },
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    component: AdminLayout,
  });

  users = navPage({
    parent: this.layout,
    path: "/users",
    head: { title: "Users" },
    permission: "admin:user:read",
    nav: { label: "Users", icon: <UsersIcon />, group: "Identity", order: 1 },
    lazy: () => import("./admin-users.tsx"),
    props: () => this.options.pages?.users ?? {},
  });

  /**
   * No `nav` — a secured route that is not a sidebar entry. The breadcrumb
   * label falls back to `head.title`.
   */
  userDetail = navPage({
    parent: this.layout,
    path: "/users/:userId",
    head: { title: "User" },
    permission: "admin:user:read",
    schema: {
      params: z.object({
        userId: z.uuid(),
      }),
    },
    lazy: () => import("./admin-user-detail.tsx"),
    props: () => this.options.pages?.userDetail ?? {},
  });

  sessions = navPage({
    parent: this.layout,
    path: "/sessions",
    head: { title: "Sessions" },
    permission: "admin:session:read",
    nav: {
      label: "Sessions",
      icon: <ShieldCheck />,
      group: "Identity",
      order: 2,
    },
    lazy: () => import("./admin-sessions.tsx"),
  });

  keys = navPage({
    parent: this.layout,
    path: "/keys",
    head: { title: "API keys" },
    permission: "admin:api-key:read",
    nav: {
      label: "API keys",
      icon: <KeyRound />,
      group: "Identity",
      order: 3,
      keywords: ["tokens", "credentials"],
    },
    lazy: () => import("./admin-keys.tsx"),
  });

  jobs = navPage({
    parent: this.layout,
    path: "/jobs",
    head: { title: "Jobs" },
    permission: "admin:job:read",
    nav: { label: "Jobs", icon: <Timer />, group: "Operations", order: 4 },
    lazy: () => import("./admin-jobs.tsx"),
  });

  notifications = navPage({
    parent: this.layout,
    path: "/notifications",
    head: { title: "Notifications" },
    permission: "admin:notification:read",
    nav: {
      label: "Notifications",
      icon: <Bell />,
      group: "Operations",
      order: 5,
    },
    lazy: () => import("./admin-notifications.tsx"),
  });

  audits = navPage({
    parent: this.layout,
    path: "/audits",
    head: { title: "Audit log" },
    permission: "admin:audit:read",
    nav: {
      label: "Audit log",
      icon: <ShieldAlert />,
      group: "Operations",
      order: 6,
    },
    lazy: () => import("./admin-audits.tsx"),
  });

  files = navPage({
    parent: this.layout,
    path: "/files",
    head: { title: "Files" },
    permission: "admin:file:read",
    nav: { label: "Files", icon: <Files />, group: "Operations", order: 7 },
    lazy: () => import("./admin-files.tsx"),
  });

  parameters = navPage({
    parent: this.layout,
    path: "/parameters",
    head: { title: "Parameters" },
    permission: "admin:parameter:read",
    nav: {
      label: "Parameters",
      icon: <SlidersHorizontal />,
      group: "Operations",
      order: 8,
      keywords: ["settings", "config", "configuration"],
    },
    lazy: () => import("./admin-parameters.tsx"),
    props: () => this.options.pages?.parameters ?? {},
  });

  /**
   * Both permissions are required, matching `AdminPaymentController`, which
   * gates every read with `["admin:payment:read", "payments:read"]` — and
   * `navPage` treats an array as AND, the same way `$secure` does.
   */
  payments = navPage({
    parent: this.layout,
    path: "/payments",
    head: { title: "Payments" },
    permission: ["admin:payment:read", "payments:read"],
    nav: {
      label: "Payments",
      icon: <CreditCard />,
      group: "Operations",
      order: 9,
    },
    lazy: () => import("./admin-payments.tsx"),
  });
}
