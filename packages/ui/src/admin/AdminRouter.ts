import type { DashboardShellProps, SidebarNode } from "@alepha/ui";
import { AuthRouter } from "@alepha/ui/auth";
import {

  IconClock,
  IconDevices,
  IconFile,
  IconHistory,
  IconKey,
  IconListDetails,
  IconPlus,
  IconSettings,
  IconTerminal2,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { $inject } from "alepha";
import type { AdminAuditController } from "alepha/api/audits";
import type { FileController } from "alepha/api/files";
import type { AdminJobController } from "alepha/api/jobs";
import type { AdminApiKeyController } from "alepha/api/keys";

import type { AdminParameterController } from "alepha/api/parameters";
import type {
  AdminSessionController,
  AdminUserController,
} from "alepha/api/users";
import { ReactAuth } from "alepha/react/auth";
import { $page, ReactRouter, Redirection } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminRouter {
  protected readonly router = $inject(ReactRouter<AdminRouter>);
  protected readonly authRouter = $inject(AuthRouter);
  protected readonly auth = $inject(ReactAuth);
  protected readonly userCtrl = $client<AdminUserController>();
  protected readonly sessionCtrl = $client<AdminSessionController>();

  protected readonly fileCtrl = $client<FileController>();
  protected readonly paramCtrl = $client<AdminParameterController>();
  protected readonly auditCtrl = $client<AdminAuditController>();
  protected readonly jobCtrl = $client<AdminJobController>();
  protected readonly apiKeyCtrl = $client<AdminApiKeyController>();

  public configFn?: (adminRouter: AdminRouter) => DashboardShellProps = () => {
    return {
      sidebarResizable: true,
      sidebarProps: {
        items: this.getDefaultSidebarItems(),
      },
    };
  };

  public getDefaultSidebarItems(): SidebarNode[] {
    return [
      {
        type: "section",
        label: "Identity",
        children: [
          {
            ...this.router.node(this.adminUsers.name),
            can: () => this.userCtrl.findUsers.can(),
          },
          {
            ...this.router.node(this.adminSessions.name),
            can: () => this.sessionCtrl.findSessions.can(),
          },
          {
            ...this.router.node(this.adminApiKeys.name),
            can: () => this.apiKeyCtrl.findApiKeys.can(),
          },
        ],
      },
      {
        type: "section",
        label: "System",
        children: [
          {
            ...this.router.node(this.adminFiles.name),
            can: () => this.fileCtrl.findFiles.can(),
          },
          {
            ...this.router.node(this.adminJobDashboard.name),
            href: undefined,
            can: () => this.jobCtrl.getRegistry.can(),
            children: [
              {
                ...this.router.node(this.adminJobDashboard.name),
                label: "Dashboard",
              },
              { ...this.router.node(this.adminJobRegistry.name) },
              { ...this.router.node(this.adminJobExecutions.name) },
            ],
          },
          {
            ...this.router.node(this.adminAudits.name),
            can: () => this.auditCtrl.findAudits.can(),
          },
          {
            ...this.router.node(this.adminParameters.name),
            can: () => this.paramCtrl.getParameterTree.can(),
          },
        ],
      },
      { type: "toggle", position: "bottom" },
    ];
  }

  protected adminShellProps(): DashboardShellProps {
    if (this.configFn) {
      return this.configFn(this);
    }
    return {};
  }

  protected onNotAuthorized(url: URL) {
    return new Redirection(
      this.router.path(this.authRouter.login.name, {
        query: {
          r: url.pathname,
        },
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminLayout = $page({
    path: "/admin",
    label: "Admin",
    lazy: () => import("./components/AdminLayout.tsx"),
    props: () => ({
      adminShellProps: this.adminShellProps(),
    }),
    loader: ({ user, url }) => {
      if (!user) {
        throw this.onNotAuthorized(url);
      }
      return {};
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminUsers = $page({
    icon: IconUsers,
    parent: this.adminLayout,
    path: "/users",
    label: "Users",
    description: "Manage application users and their roles.",
    lazy: () => import("./components/users/AdminUsers.tsx"),
    can: () => this.userCtrl.findUsers.can(),
  });

  public readonly adminUserCreate = $page({
    icon: IconPlus,
    parent: this.adminLayout,
    path: "/users/create",
    label: "Create User",
    description: "Create a new user account",
    lazy: () => import("./components/users/AdminUserCreate.tsx"),
    can: () => this.userCtrl.createUser.can(),
  });

  public readonly adminUserLayout = $page({
    icon: IconUser,
    parent: this.adminLayout,
    path: "/users/:userId",
    label: "User",
    lazy: () => import("./components/users/AdminUserLayout.tsx"),
    can: () => this.userCtrl.getUser.can(),
  });

  public readonly adminUserDetails = $page({
    parent: this.adminUserLayout,
    path: "/details",
    label: "Details",
    lazy: () => import("./components/users/AdminUserDetails.tsx"),
  });

  public readonly adminUserSessions = $page({
    parent: this.adminUserLayout,
    path: "/sessions",
    label: "Sessions",
    lazy: () => import("./components/users/AdminUserSessions.tsx"),
  });

  public readonly adminUserSettings = $page({
    parent: this.adminUserLayout,
    path: "/settings",
    label: "Settings",
    lazy: () => import("./components/users/AdminUserSettings.tsx"),
  });

  public readonly adminUserAudits = $page({
    parent: this.adminUserLayout,
    path: "/audits",
    label: "Audit Log",
    lazy: () => import("./components/users/AdminUserAudits.tsx"),
    can: () => this.auditCtrl.findByUser.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Audits (Global)
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminAudits = $page({
    icon: IconHistory,
    parent: this.adminLayout,
    path: "/audits",
    label: "Audit Log",
    description: "View system-wide audit trail and activity logs.",
    lazy: () => import("./components/audits/AdminAudits.tsx"),
    can: () => this.auditCtrl.findAudits.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminSessions = $page({
    icon: IconDevices,
    parent: this.adminLayout,
    path: "/sessions",
    label: "Sessions",
    description: "View and manage all active sessions.",
    lazy: () => import("./components/sessions/AdminSessions.tsx"),
    can: () => this.sessionCtrl.findSessions.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Files
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminFiles = $page({
    icon: IconFile,
    parent: this.adminLayout,
    path: "/files",
    label: "Files",
    description: "Manage uploaded files and storage.",
    lazy: () => import("./components/files/AdminFiles.tsx"),
    can: () => this.fileCtrl.findFiles.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Parameters
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminParameters = $page({
    icon: IconSettings,
    parent: this.adminLayout,
    path: "/parameters",
    label: "Parameters",
    description: "View and manage application parameters.",
    lazy: () => import("./components/parameters/AdminParameters.tsx"),
    can: () => this.paramCtrl.getParameterTree.can(),
    loader: async () => {
      const treeData = await this.paramCtrl.getParameterTree({});
      return { treeData };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Jobs
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminJobDashboard = $page({
    icon: IconTerminal2,
    parent: this.adminLayout,
    path: "/jobs",
    label: "Jobs",
    description: "Monitor and manage background jobs and scheduled tasks.",
    lazy: () => import("./components/jobs/AdminJobDashboard.tsx"),
    can: () => this.jobCtrl.getRegistry.can(),
  });

  public readonly adminJobRegistry = $page({
    icon: IconListDetails,
    parent: this.adminLayout,
    path: "/jobs/registry",
    label: "Registry",
    description: "View all registered job definitions.",
    lazy: () => import("./components/jobs/AdminJobRegistry.tsx"),
    can: () => this.jobCtrl.getRegistry.can(),
  });

  public readonly adminJobExecutions = $page({
    icon: IconClock,
    parent: this.adminLayout,
    path: "/jobs/executions",
    label: "Executions",
    description: "Browse and filter job execution history.",
    lazy: () => import("./components/jobs/AdminJobExecutions.tsx"),
    can: () => this.jobCtrl.findExecutions.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // API Keys
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminApiKeys = $page({
    icon: IconKey,
    parent: this.adminLayout,
    path: "/api-keys",
    label: "API Keys",
    description: "View and manage API keys for programmatic access.",
    lazy: () => import("./components/keys/AdminApiKeys.tsx"),
    can: () => this.apiKeyCtrl.findApiKeys.can(),
  });
}
