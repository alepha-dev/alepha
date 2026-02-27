import {
  type AppBarItem,
  alephaSidebarAtom,
  Breadcrumbs,
  type DashboardShellProps,
  LanguageButton,
  type SidebarNode,
  ThemeButton,
} from "@alepha/ui";
import { AuthRouter, UserButton } from "@alepha/ui/auth";
import {
  IconBell,
  IconClock,
  IconDashboard,
  IconDevices,
  IconFile,
  IconHistory,
  IconKey,
  IconLayoutDashboard,
  IconListDetails,
  IconLockPassword,
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
import type { AdminNotificationController } from "alepha/api/notifications";
import type { AdminParameterController } from "alepha/api/parameters";
import type {
  AdminSessionController,
  AdminUserController,
} from "alepha/api/users";
import { ReactAuth } from "alepha/react/auth";
import { $page, ReactRouter, Redirection } from "alepha/react/router";
import { $cookie } from "alepha/server/cookies";
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
  protected readonly notificationCtrl = $client<AdminNotificationController>();

  public readonly adminCookie = $cookie(alephaSidebarAtom, {
    name: "admin.sidebar",
  });

  public configFn?: (adminRouter: AdminRouter) => DashboardShellProps = () => {
    return {
      sidebarProps: {
        items: this.getDefaultSidebarItems(),
      },
      appBarProps: {
        items: this.getDefaultAppBarItems(),
      },
    };
  };

  public getDefaultAppBarItems(): AppBarItem[] {
    return [
      {
        type: "burger",
        position: "left",
      },
      {
        element: <Breadcrumbs />,
        position: "left",
      },
      {
        element: <UserButton />,
        position: "right",
      },
      {
        element: <ThemeButton expert />,
        position: "right",
      },
      {
        element: <LanguageButton />,
        position: "right",
      },
      {
        type: "dark",
        position: "right",
      },
    ];
  }

  public getDefaultSidebarItems(): SidebarNode[] {
    return [
      {
        position: "top",
        type: "search",
      },
      {
        position: "top",
        type: "spacer",
      },
      {
        label: "Dashboard",
        href: "/admin",
        icon: IconLayoutDashboard,
      },
      {
        type: "section",
        label: "Security",
        children: [
          {
            label: "Identity",
            icon: IconLockPassword,
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
            ...this.router.node(this.adminAudits.name),
            can: () => this.auditCtrl.findAudits.can(),
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
            label: "Jobs",
            icon: IconTerminal2,
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
            ...this.router.node(this.adminNotifications.name),
            can: () => this.notificationCtrl.findNotifications.can(),
          },
          {
            ...this.router.node(this.adminParameters.name),
            can: () => this.paramCtrl.getParameterTree.can(),
          },
        ],
      },
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
    head: {
      title: "Admin Panel",
      titleSeparator: " | ",
    },
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
  // Dashboard
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminDashboard = $page({
    icon: IconLayoutDashboard,
    parent: this.adminLayout,
    path: "/",
    label: "Dashboard",
    lazy: () => import("./components/AdminDashboard.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminUsers = $page({
    icon: IconUsers,
    parent: this.adminLayout,
    path: "/users",
    label: "Users",
    head: {
      title: "Users",
    },
    description: "Manage application users and their roles.",
    lazy: () => import("./components/users/AdminUsers.tsx"),
    can: () => this.userCtrl.findUsers.can(),
  });

  public readonly adminUserLayout = $page({
    parent: this.adminLayout,
    path: "/users/:userId",
    head: {
      title: "Users",
    },
    lazy: () => import("./components/users/AdminUserLayout.tsx"),
  });

  public readonly adminUserProfile = $page({
    icon: IconUser,
    parent: this.adminUserLayout,
    path: "/",
    label: "Profile",
    head: {
      title: "User Profile",
    },
    lazy: () => import("./components/users/AdminUserProfile.tsx"),
  });

  public readonly adminUserSessions = $page({
    icon: IconDevices,
    parent: this.adminUserLayout,
    path: "/sessions",
    label: "Sessions",
    head: {
      title: "User Sessions",
    },
    lazy: () => import("./components/users/AdminUserSessions.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Audits (Global)
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminAudits = $page({
    icon: IconHistory,
    parent: this.adminLayout,
    path: "/audits",
    label: "Audit Log",
    head: {
      title: "Audit Logs",
    },
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
    head: {
      title: "Sessions",
    },
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
    head: {
      title: "Files",
    },
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
    head: {
      title: "Parameters",
    },
    loader: async () => {
      const treeData = await this.paramCtrl.getParameterTree({});
      return { treeData };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Jobs
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminJobDashboard = $page({
    icon: IconDashboard,
    parent: this.adminLayout,
    path: "/jobs",
    label: "Jobs",
    description: "Monitor and manage background jobs and scheduled tasks.",
    lazy: () => import("./components/jobs/AdminJobDashboard.tsx"),
    can: () => this.jobCtrl.getJobRegistry.can(),
  });

  public readonly adminJobRegistry = $page({
    icon: IconListDetails,
    parent: this.adminLayout,
    path: "/jobs/registry",
    label: "Registry",
    description: "View all registered job definitions.",
    lazy: () => import("./components/jobs/AdminJobRegistry.tsx"),
    can: () => this.jobCtrl.getJobRegistry.can(),
  });

  public readonly adminJobExecutions = $page({
    icon: IconClock,
    parent: this.adminLayout,
    path: "/jobs/executions",
    label: "Executions",
    description: "Browse and filter job execution history.",
    lazy: () => import("./components/jobs/AdminJobExecutions.tsx"),
    can: () => this.jobCtrl.findJobExecutions.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // API Keys
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminApiKeys = $page({
    icon: IconKey,
    parent: this.adminLayout,
    path: "/api-keys",
    label: "API Keys",
    head: {
      title: "API Keys",
    },
    description: "View and manage API keys for programmatic access.",
    lazy: () => import("./components/keys/AdminApiKeys.tsx"),
    can: () => this.apiKeyCtrl.findApiKeys.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminNotifications = $page({
    icon: IconBell,
    parent: this.adminLayout,
    path: "/notifications",
    label: "Notifications",
    description: "View sent notifications and their delivery status.",
    head: {
      title: "Notifications",
    },
    lazy: () => import("./components/notifications/AdminNotifications.tsx"),
    can: () => this.notificationCtrl.findNotifications.can(),
  });
}
