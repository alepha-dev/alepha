import { IconDevices, IconUser, IconUsers } from "@tabler/icons-react";
import { t } from "alepha";
import type {
  AdminSessionController,
  AdminUserController,
} from "alepha/api/users";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminUserRouter {
  protected readonly userCtrl = $client<AdminUserController>();
  protected readonly sessionCtrl = $client<AdminSessionController>();

  adminUsers = $page({
    icon: IconUsers,
    path: "/users",
    label: "Users",
    description: "Manage application users and their roles.",
    head: { title: "Users" },
    can: () => this.userCtrl.findUsers.can(),
    lazy: () => import("./components/AdminUsers.tsx"),
  });

  adminUserLayout = $page({
    path: "/users/:userId",
    head: { title: "Users" },
    schema: {
      params: t.object({
        userId: t.text(),
      }),
    },
    lazy: () => import("./components/AdminUserLayout.tsx"),
    loader: async ({ params }: { params: { userId: string } }) => {
      const user = await this.userCtrl.getUser({
        params: { id: params.userId },
      });
      return { user };
    },
  });

  adminUserProfile = $page({
    icon: IconUser,
    parent: this.adminUserLayout,
    path: "/",
    label: "Profile",
    head: { title: "User Profile" },
    lazy: () => import("./components/AdminUserProfile.tsx"),
  });

  adminUserSessions = $page({
    icon: IconDevices,
    parent: this.adminUserLayout,
    path: "/sessions",
    label: "Sessions",
    head: { title: "User Sessions" },
    lazy: () => import("./components/AdminUserSessions.tsx"),
  });
}
