import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUserDetail } from "@alepha/ui/components/admin/admin-user-detail";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { navPage } from "@alepha/ui/components/nav-shell/nav-page";
import { t } from "alepha";
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
import { AppAdminLayout } from "./AppAdminLayout.tsx";

/**
 * Admin shell routes. Each leaf is declared with `navPage`, which co-locates
 * the page's permission (wired into both the `$secure` route gate and the nav
 * gate) and its `nav` metadata (label / icon / group / order). The sidebar and
 * breadcrumbs are derived from this tree by `<NavShell>` in AppAdminLayout —
 * there is no separate hand-maintained nav list.
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
    component: AppAdminLayout,
  });

  adminUsers = navPage({
    path: "/users",
    head: { title: "Users" },
    permission: "admin:user:read",
    nav: { label: "Users", icon: <UsersIcon />, group: "Identity", order: 1 },
    component: AdminUsers,
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
      params: t.object({
        id: t.uuid(),
      }),
    },
    component: AdminUserDetail,
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
    component: AdminSessions,
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
    component: AdminKeys,
    parent: this.adminLayout,
  });

  adminJobs = navPage({
    path: "/jobs",
    head: { title: "Jobs" },
    permission: "admin:job:read",
    nav: { label: "Jobs", icon: <Timer />, group: "Operations", order: 4 },
    component: AdminJobs,
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
    component: AdminNotifications,
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
    component: AdminAudits,
    parent: this.adminLayout,
  });

  adminFiles = navPage({
    path: "/files",
    head: { title: "Files" },
    permission: "admin:file:read",
    nav: { label: "Files", icon: <Files />, group: "Operations", order: 7 },
    component: AdminFiles,
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
    component: AdminParameters,
    parent: this.adminLayout,
  });
}
