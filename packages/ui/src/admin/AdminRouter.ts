import { $page, ReactRouter, Redirection } from "@alepha/react";
import { ReactAuth } from "@alepha/react/auth";
import { AuthRouter } from "@alepha/ui/auth";
import {
  IconBell,
  IconDevices,
  IconFile,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { $inject } from "alepha";
import type { FileController } from "alepha/api/files";
import type { NotificationController } from "alepha/api/notifications";
import type { SessionController, UserController } from "alepha/api/users";
import { $client } from "alepha/server/links";

export class AdminRouter {
  protected readonly router = $inject(ReactRouter);
  protected readonly authRouter = $inject(AuthRouter);
  protected readonly auth = $inject(ReactAuth);
  protected readonly userCtrl = $client<UserController>();
  protected readonly sessionCtrl = $client<SessionController>();
  protected readonly notificationCtrl = $client<NotificationController>();
  protected readonly fileCtrl = $client<FileController>();

  // ─────────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly layout = $page({
    name: "AdminLayout",
    path: "/admin",
    label: "Admin",
    lazy: () => import("./components/AdminLayout.tsx"),
    resolve: ({ user, url }) => {
      if (!user) {
        throw new Redirection(
          this.router.path(this.authRouter.login.name, {
            query: {
              r: url.pathname,
            },
          }),
        );
      }
      return {};
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminUsers = $page({
    icon: IconUsers,
    parent: this.layout,
    path: "/users",
    label: "Users",
    description: "Manage application users and their roles.",
    lazy: () => import("./components/AdminUsers.tsx"),
    can: () => this.userCtrl.findUsers.can(),
  });

  public readonly adminUserCreate = $page({
    icon: IconPlus,
    parent: this.layout,
    path: "/users/create",
    label: "Create User",
    description: "Create a new user account.",
    lazy: () => import("./components/AdminUserCreate.tsx"),
    can: () => this.userCtrl.createUser.can(),
  });

  public readonly adminUserLayout = $page({
    icon: IconUser,
    parent: this.layout,
    path: "/users/:userId",
    label: "User",
    lazy: () => import("./components/AdminUserLayout.tsx"),
    can: () => this.userCtrl.getUser.can(),
  });

  public readonly adminUserDetails = $page({
    parent: this.adminUserLayout,
    path: "/details",
    label: "Details",
    lazy: () => import("./components/AdminUserDetails.tsx"),
  });

  public readonly adminUserSessions = $page({
    parent: this.adminUserLayout,
    path: "/sessions",
    label: "Sessions",
    lazy: () => import("./components/AdminUserSessions.tsx"),
  });

  public readonly adminUserSettings = $page({
    parent: this.adminUserLayout,
    path: "/settings",
    label: "Settings",
    lazy: () => import("./components/AdminUserSettings.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Sessions
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminSessions = $page({
    icon: IconDevices,
    parent: this.layout,
    path: "/sessions",
    label: "Sessions",
    description: "View and manage all active sessions.",
    lazy: () => import("./components/AdminSessions.tsx"),
    can: () => this.sessionCtrl.findSessions.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminNotifications = $page({
    icon: IconBell,
    parent: this.layout,
    path: "/notifications",
    label: "Notifications",
    description: "View notification history and status.",
    lazy: () => import("./components/AdminNotifications.tsx"),
    can: () => this.notificationCtrl.findNotifications.can(),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Files
  // ─────────────────────────────────────────────────────────────────────────────

  public readonly adminFiles = $page({
    icon: IconFile,
    parent: this.layout,
    path: "/files",
    label: "Files",
    description: "Manage uploaded files and storage.",
    lazy: () => import("./components/AdminFiles.tsx"),
    can: () => this.fileCtrl.findFiles.can(),
  });
}
