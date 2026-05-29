import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUserDetail } from "@alepha/ui/components/admin/admin-user-detail";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { t } from "alepha";
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
    use: [$secure({ permissions: ["admin:user:read"] })],
    component: AdminUsers,
    props: () => ({
      defaultHiddenColumns: ["firstName", "lastName"] as const,
    }),
    parent: this.adminLayout,
  });

  adminUserDetail = $page({
    path: "/users/:id",
    head: { title: "User" },
    use: [$secure({ permissions: ["admin:user:read"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
    },
    component: AdminUserDetail,
    parent: this.adminLayout,
  });

  adminSessions = $page({
    path: "/sessions",
    head: { title: "Sessions" },
    use: [$secure({ permissions: ["admin:session:read"] })],
    component: AdminSessions,
    parent: this.adminLayout,
  });

  adminKeys = $page({
    path: "/keys",
    head: { title: "API keys" },
    use: [$secure({ permissions: ["admin:api-key:read"] })],
    component: AdminKeys,
    parent: this.adminLayout,
  });

  adminJobs = $page({
    path: "/jobs",
    head: { title: "Jobs" },
    use: [$secure({ permissions: ["admin:job:read"] })],
    component: AdminJobs,
    parent: this.adminLayout,
  });

  adminNotifications = $page({
    path: "/notifications",
    head: { title: "Notifications" },
    use: [$secure({ permissions: ["admin:notification:read"] })],
    component: AdminNotifications,
    parent: this.adminLayout,
  });

  adminAudits = $page({
    path: "/audits",
    head: { title: "Audit log" },
    use: [$secure({ permissions: ["admin:audit:read"] })],
    component: AdminAudits,
    parent: this.adminLayout,
  });

  adminFiles = $page({
    path: "/files",
    head: { title: "Files" },
    use: [$secure({ permissions: ["admin:file:read"] })],
    component: AdminFiles,
    parent: this.adminLayout,
  });

  adminParameters = $page({
    path: "/parameters",
    head: { title: "Parameters" },
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    component: AdminParameters,
    parent: this.adminLayout,
  });
}
