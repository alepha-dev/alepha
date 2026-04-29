import { $uiAdmin } from "@alepha/mantine/admin";
import { AdminAuditRouter } from "@alepha/mantine/admin-audits";
import { AdminFileRouter } from "@alepha/mantine/admin-files";
import { AdminJobRouter } from "@alepha/mantine/admin-jobs";
import { AdminApiKeyRouter } from "@alepha/mantine/admin-keys";
import { AdminNotificationRouter } from "@alepha/mantine/admin-notifications";
import { AdminParameterRouter } from "@alepha/mantine/admin-parameters";
import { AdminPaymentRouter } from "@alepha/mantine/admin-payments";
import { AdminSessionRouter } from "@alepha/mantine/admin-sessions";
import { AdminUserRouter } from "@alepha/mantine/admin-users";
import { UserButton } from "@alepha/mantine/auth";
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
  protected payments = $inject(AdminPaymentRouter);

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
      this.users.adminUserLayout,
      this.users.adminUsers,
      this.sessions.adminSessions,
      this.audits.adminAudits,
      this.files.adminFiles,
      this.parameters.adminParameters,
      this.jobs.adminJobs,
      this.apiKeys.adminApiKeys,
      this.notifications.adminNotifications,
      this.payments.adminPayments,
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
