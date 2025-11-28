import { $page } from "@alepha/react";

export class AdminRouter {
  admin = $page({
    path: "/admin",
    label: "Admin",
    lazy: () => import("./components/AdminLayout.tsx"),
  });

  adminUsers = $page({
    parent: this.admin,
    path: "/users",
    label: "Users",
    lazy: () => import("./components/AdminUsers.tsx"),
  });
}
