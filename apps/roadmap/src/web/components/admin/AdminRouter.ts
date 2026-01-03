import { $page } from "@alepha/react/router";

export class AdminRouter {
  admin = $page({
    path: "/admin",
    lazy: () => import("./AdminLayout.jsx"),
  });

  users = $page({
    parent: this.admin,
    path: "/users",
    lazy: () => import("./AdminUsers.jsx"),
  });

  projects = $page({
    parent: this.admin,
    path: "/projects",
    lazy: () => import("./AdminProjects.jsx"),
  });
}
