import { navPage } from "@alepha/ui/components/nav-shell/nav-page";
import { z } from "alepha";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import {
  Bell,
  Files,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UsersIcon,
} from "lucide-react";

/**
 * Admin shell routes. Each leaf is declared with `navPage`, which co-locates
 * the page's permission (wired into both the `$secure` route gate and the nav
 * gate) and its `nav` metadata (label / icon / group / order). The sidebar and
 * breadcrumbs are derived from this tree by `<NavShell>` in AppAdminLayout —
 * there is no separate hand-maintained nav list.
 *
 * Every page component is `lazy`-imported so the admin area is code-split out
 * of the main bundle and each page loads on demand.
 */
export class AppAdminRouter {
  adminLayout = $page({
    name: "admin",
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    // Anchors the shell + first breadcrumb ("Admin"). Not itself a nav entry
    // (the shell root is excluded from its own sidebar).
    nav: { label: "Admin" },
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    lazy: () => import("./AppAdminLayout.tsx"),
  });

  adminUsers = navPage({
    path: "/users",
    head: { title: "Users" },
    permission: "admin:user:read",
    nav: { label: "Users", icon: <UsersIcon />, group: "Identity", order: 1 },
    lazy: () => import("@alepha/ui/components/admin/admin-users"),
    props: () => ({
      defaultHiddenColumns: ["firstName", "lastName"] as const,
    }),
    parent: this.adminLayout,
  });

  adminUserDetail = navPage({
    path: "/users/:id",
    head: { title: "User" },
    permission: "admin:user:read",
    // No `nav` → secured route, but not a sidebar entry. Breadcrumb label
    // falls back to `head.title`.
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
    },
    lazy: () => import("@alepha/ui/components/admin/admin-user-detail"),
    parent: this.adminLayout,
  });

  adminSessions = navPage({
    path: "/sessions",
    head: { title: "Sessions" },
    permission: "admin:session:read",
    nav: {
      label: "Sessions",
      icon: <ShieldCheck />,
      group: "Identity",
      order: 2,
    },
    lazy: () => import("@alepha/ui/components/admin/admin-sessions"),
    parent: this.adminLayout,
  });

  adminKeys = navPage({
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
    lazy: () => import("@alepha/ui/components/admin/admin-keys"),
    parent: this.adminLayout,
  });

  adminJobs = navPage({
    path: "/jobs",
    head: { title: "Jobs" },
    permission: "admin:job:read",
    nav: { label: "Jobs", icon: <Timer />, group: "Operations", order: 4 },
    lazy: () => import("@alepha/ui/components/admin/admin-jobs"),
    parent: this.adminLayout,
  });

  adminNotifications = navPage({
    path: "/notifications",
    head: { title: "Notifications" },
    permission: "admin:notification:read",
    nav: {
      label: "Notifications",
      icon: <Bell />,
      group: "Operations",
      order: 5,
    },
    lazy: () => import("@alepha/ui/components/admin/admin-notifications"),
    parent: this.adminLayout,
  });

  adminAudits = navPage({
    path: "/audits",
    head: { title: "Audit log" },
    permission: "admin:audit:read",
    nav: {
      label: "Audit log",
      icon: <ShieldAlert />,
      group: "Operations",
      order: 6,
    },
    lazy: () => import("@alepha/ui/components/admin/admin-audits"),
    parent: this.adminLayout,
  });

  adminFiles = navPage({
    path: "/files",
    head: { title: "Files" },
    permission: "admin:file:read",
    nav: { label: "Files", icon: <Files />, group: "Operations", order: 7 },
    lazy: () => import("@alepha/ui/components/admin/admin-files"),
    parent: this.adminLayout,
  });

  adminParameters = navPage({
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
    lazy: () => import("@alepha/ui/components/admin/admin-parameters"),
    parent: this.adminLayout,
  });
}
