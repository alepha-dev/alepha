import { $page, ReactRouter, Redirection } from "@alepha/react";
import { ReactAuth } from "@alepha/react/auth";
import { AuthRouter } from "@alepha/ui/auth";
import { IconUser } from "@tabler/icons-react";
import { $inject } from "alepha";
import type { FileController } from "alepha/api/files";
import type { UserController } from "alepha/api/users";
import { $client } from "alepha/server/links";

export class AdminRouter {
  protected readonly router = $inject(ReactRouter);
  protected readonly authRouter = $inject(AuthRouter);
  protected readonly auth = $inject(ReactAuth);
  protected readonly userCtrl = $client<UserController>();
  protected readonly fileCtrl = $client<FileController>();

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

  public readonly adminUsers = $page({
    icon: IconUser,
    parent: this.layout,
    path: "/users",
    label: "User Management",
    description: "Manage application users and their roles.",
    lazy: () => import("./components/AdminUsers.tsx"),
    can: () => this.userCtrl.findUsers.can(),
  });

  //
  // adminNotifications = $page({
  //   parent: this.admin,
  //   path: "/notifications",
  //   label: "Notifications",
  //   lazy: () => import("./components/AdminNotifications.tsx"),
  // });
  //
  // adminSessions = $page({
  //   parent: this.admin,
  //   path: "/sessions",
  //   label: "Sessions",
  //   lazy: () => import("./components/AdminSessions.tsx"),
  // });
  //
  // adminVerifications = $page({
  //   parent: this.admin,
  //   path: "/verifications",
  //   label: "Verifications",
  //   lazy: () => import("./components/AdminVerifications.tsx"),
  // });
  //
  // adminJobs = $page({
  //   parent: this.admin,
  //   path: "/jobs",
  //   label: "Jobs",
  //   lazy: () => import("./components/AdminJobs.tsx"),
  // });
  //
  // adminParameters = $page({
  //   parent: this.admin,
  //   path: "/parameters",
  //   label: "Parameters",
  //   lazy: () => import("./components/AdminParameters.tsx"),
  // });
  //

  adminFiles = $page({
    parent: this.layout,
    path: "/files",
    label: "File Storage",
    lazy: () => import("./components/AdminFiles.tsx"),
    can: () => this.fileCtrl.findFiles.can(),
  });
}
