import { ReactAuth } from "@alepha/react/auth";
import { $page, ReactRouter, Redirection } from "@alepha/react/router";
import type { AdminShellProps } from "@alepha/ui";
import { AuthRouter } from "@alepha/ui/auth";
import {
  IconBell,
  IconDevices,
  IconFile,
  IconHistory,
  IconPlus,
  IconSettings,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { $inject } from "alepha";
import type { AdminAuditController } from "alepha/api/audits";
import type { FileController } from "alepha/api/files";
import type { AdminNotificationController } from "alepha/api/notifications";
import type { AdminConfigController } from "alepha/api/parameters";
import type {
  AdminSessionController,
  AdminUserController,
} from "alepha/api/users";
import { $client } from "alepha/server/links";

export class AdminRouter {
  protected readonly router = $inject(ReactRouter);
  protected readonly authRouter = $inject(AuthRouter);
  protected readonly auth = $inject(ReactAuth);
  protected readonly userCtrl = $client<AdminUserController>();
  protected readonly sessionCtrl = $client<AdminSessionController>();
  protected readonly notificationCtrl = $client<AdminNotificationController>();
  protected readonly fileCtrl = $client<FileController>();
  protected readonly configCtrl = $client<AdminConfigController>();
  protected readonly auditCtrl = $client<AdminAuditController>();

  protected adminShellProps(): AdminShellProps {
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
    resolve: ({ user, url }) => {
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
    description: "Create a new user account.",
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
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminNotifications = $page({
    icon: IconBell,
    parent: this.adminLayout,
    path: "/notifications",
    label: "Notifications",
    description: "View notification history and status.",
    lazy: () => import("./components/notifications/AdminNotifications.tsx"),
    can: () => this.notificationCtrl.findNotifications.can(),
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
    description: "View and manage application configuration parameters.",
    lazy: () => import("./components/parameters/AdminParameters.tsx"),
    can: () => this.configCtrl.getConfigTree.can(),
  });
}
