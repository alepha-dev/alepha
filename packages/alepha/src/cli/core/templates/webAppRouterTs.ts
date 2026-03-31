export const webAppRouterTs = (options: {
  api?: boolean;
  ui?: boolean;
  auth?: boolean;
  admin?: boolean;
}) => {
  const imports: string[] = [];
  const classMembers: string[] = [];

  // UI import and setup
  if (options.ui) {
    imports.push('import { $ui } from "@alepha/ui";');
  }

  // Auth import
  if (options.auth) {
    imports.push('import { $uiAuth } from "@alepha/ui/auth";');
  }

  // Admin imports
  if (options.admin) {
    imports.push('import { $uiAdmin } from "@alepha/ui/admin";');
    imports.push('import { AdminUserRouter } from "@alepha/ui/admin-users";');
    imports.push(
      'import { AdminSessionRouter } from "@alepha/ui/admin-sessions";',
    );
    imports.push('import { AdminAuditRouter } from "@alepha/ui/admin-audits";');
    imports.push('import { AdminFileRouter } from "@alepha/ui/admin-files";');
    imports.push(
      'import { AdminParameterRouter } from "@alepha/ui/admin-parameters";',
    );
    imports.push('import { AdminJobRouter } from "@alepha/ui/admin-jobs";');
    imports.push('import { AdminApiKeyRouter } from "@alepha/ui/admin-keys";');
    imports.push(
      'import { AdminNotificationRouter } from "@alepha/ui/admin-notifications";',
    );
    imports.push(
      'import { AdminBillingRouter } from "@alepha/ui/admin-billing";',
    );
    imports.push('import { $inject } from "alepha";');
    imports.push(
      'import { IconLayoutDashboard, IconLockPassword, IconCreditCard } from "@tabler/icons-react";',
    );
  }

  // Page import
  imports.push('import { $page } from "alepha/react/router";');

  // API imports (only if api flag is set)
  if (options.api) {
    imports.push('import { $client } from "alepha/server/links";');
    imports.push(
      'import type { HelloController } from "../api/controllers/HelloController.ts";',
    );
    classMembers.push("  api = $client<HelloController>();");
  }

  // UI layout setup
  if (options.ui) {
    classMembers.push("  ui = $ui();");

    if (options.auth) {
      classMembers.push("  uiAuth = $uiAuth();");
    }

    if (options.admin) {
      classMembers.push(`  // ── Admin Domain Routers ──────────────────────────
  protected users = $inject(AdminUserRouter);
  protected sessions = $inject(AdminSessionRouter);
  protected audits = $inject(AdminAuditRouter);
  protected files = $inject(AdminFileRouter);
  protected parameters = $inject(AdminParameterRouter);
  protected jobs = $inject(AdminJobRouter);
  protected apiKeys = $inject(AdminApiKeyRouter);
  protected notifications = $inject(AdminNotificationRouter);
  protected billing = $inject(AdminBillingRouter);

  // ── Admin Panel ─────────────────────────────────
  admin = $uiAdmin({
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
        label: "Security",
        children: [
          { label: "Identity", icon: IconLockPassword, children: [
            this.users.adminUsers,
            this.sessions.adminSessions,
            this.apiKeys.adminApiKeys,
          ]},
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
      {
        label: "Commerce",
        icon: IconCreditCard,
        children: [
          this.billing.adminBilling,
        ],
      },
    ],
  });

  // ── Admin Dashboard ─────────────────────────────
  adminDashboard = $page({
    parent: this.admin.adminLayout,
    path: "/",
    label: "Dashboard",
    icon: IconLayoutDashboard,
    lazy: () => import("./components/AdminDashboard.tsx"),
  });`);
    }

    classMembers.push(`  layout = $page({
      parent: this.ui.root,
      children: () => [this.home],
    });`);
  }

  // Home page - with or without loader
  if (options.api) {
    classMembers.push(`  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });`);
  } else {
    classMembers.push(`  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
  });`);
  }

  return `${imports.join("\n")}

export class AppRouter {
${classMembers.join("\n\n")}
}`;
};
