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

  adminNotifications = $page({
    parent: this.admin,
    path: "/notifications",
    label: "Notifications",
    lazy: () => import("./components/AdminNotifications.tsx"),
  });

  adminSessions = $page({
    parent: this.admin,
    path: "/sessions",
    label: "Sessions",
    lazy: () => import("./components/AdminSessions.tsx"),
  });

  adminVerifications = $page({
    parent: this.admin,
    path: "/verifications",
    label: "Verifications",
    lazy: () => import("./components/AdminVerifications.tsx"),
  });

  adminJobs = $page({
    parent: this.admin,
    path: "/jobs",
    label: "Jobs",
    lazy: () => import("./components/AdminJobs.tsx"),
  });

  adminParameters = $page({
    parent: this.admin,
    path: "/parameters",
    label: "Parameters",
    lazy: () => import("./components/AdminParameters.tsx"),
  });

  adminFiles = $page({
    parent: this.admin,
    path: "/files",
    label: "Files",
    lazy: () => import("./components/AdminFiles.tsx"),
  });
}
