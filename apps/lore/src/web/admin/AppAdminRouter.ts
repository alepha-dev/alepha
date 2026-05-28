import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import { AppAdminLayout } from "./AppAdminLayout.tsx";

/**
 * Admin shell. Each leaf page mounts an `@alepha/ui` admin block. The
 * layout component owns the sidebar nav, breadcrumb trail, dark-mode
 * toggle and account menu. Sub-routes only declare their component.
 */
export class AppAdminRouter {
  adminLayout = $page({
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    component: AppAdminLayout,
  });

  adminUsers = $page({
    path: "/users",
    head: { title: "Users" },
    component: AdminUsers,
    parent: this.adminLayout,
  });

  adminSessions = $page({
    path: "/sessions",
    head: { title: "Sessions" },
    component: AdminSessions,
    parent: this.adminLayout,
  });

  adminKeys = $page({
    path: "/keys",
    head: { title: "API keys" },
    component: AdminKeys,
    parent: this.adminLayout,
  });

  adminJobs = $page({
    path: "/jobs",
    head: { title: "Jobs" },
    component: AdminJobs,
    parent: this.adminLayout,
  });

  adminNotifications = $page({
    path: "/notifications",
    head: { title: "Notifications" },
    component: AdminNotifications,
    parent: this.adminLayout,
  });

  adminAudits = $page({
    path: "/audits",
    head: { title: "Audit log" },
    component: AdminAudits,
    parent: this.adminLayout,
  });

  adminFiles = $page({
    path: "/files",
    head: { title: "Files" },
    component: AdminFiles,
    parent: this.adminLayout,
  });
}
