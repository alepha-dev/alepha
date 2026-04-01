import { $uiAdmin } from "@alepha/ui/admin";
import { AdminAuditRouter } from "@alepha/ui/admin-audits";
import { AdminBillingRouter } from "@alepha/ui/admin-billing";
import { AdminFileRouter } from "@alepha/ui/admin-files";
import { AdminJobRouter } from "@alepha/ui/admin-jobs";
import { AdminApiKeyRouter } from "@alepha/ui/admin-keys";
import { AdminNotificationRouter } from "@alepha/ui/admin-notifications";
import { AdminParameterRouter } from "@alepha/ui/admin-parameters";
import { AdminSessionRouter } from "@alepha/ui/admin-sessions";
import { AdminUserRouter } from "@alepha/ui/admin-users";
import { UserButton } from "@alepha/ui/auth";
import { IconLayoutDashboard } from "@tabler/icons-react";
import { $inject } from "alepha";
import { $page } from "alepha/react/router";
import { createElement } from "react";

export class AppAdminRouter {
  protected users = $inject(AdminUserRouter);
  protected sessions = $inject(AdminSessionRouter);
  protected audits = $inject(AdminAuditRouter);
  protected files = $inject(AdminFileRouter);
  protected parameters = $inject(AdminParameterRouter);
  protected jobs = $inject(AdminJobRouter);
  protected apiKeys = $inject(AdminApiKeyRouter);
  protected notifications = $inject(AdminNotificationRouter);
  protected billing = $inject(AdminBillingRouter);

  adminLayout = $uiAdmin({
    shellProps: {
      appBarProps: {
        items: [
          {
            position: "right",
            element: createElement(UserButton),
          },
          {
            position: "right",
            type: "theme",
          },
          {
            position: "right",
            type: "lang",
          },
          {
            position: "right",
            type: "dark",
          },
        ],
      },
    },
    pages: [
      this.users.adminUsers,
      this.sessions.adminSessions,
      this.audits.adminAudits,
      this.files.adminFiles,
      this.parameters.adminParameters,
      this.jobs.adminJobs,
      this.apiKeys.adminApiKeys,
      this.notifications.adminNotifications,
      this.billing.adminBilling,
    ],
    sidebarItems: [
      {
        label: "Identity",
        children: [
          this.users.adminUsers,
          this.sessions.adminSessions,
          this.apiKeys.adminApiKeys,
          this.audits.adminAudits,
        ],
      },
      {
        label: "System",
        children: [
          this.files.adminFiles,
          this.jobs.adminJobs,
          this.notifications.adminNotifications,
          this.parameters.adminParameters,
        ],
      },
    ],
  });

  // ── Dashboard ───────────────────────────────────
  dashboard = $page({
    parent: this.adminLayout,
    path: "/",
    label: "Dashboard",
    icon: IconLayoutDashboard,
    lazy: () => import("./components/Dashboard.tsx"),
  });
}
