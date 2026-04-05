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
    imports.push('import { $inject } from "alepha";');
    imports.push('import { IconLayoutDashboard } from "@tabler/icons-react";');
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

  // ── Admin Panel ─────────────────────────────────
  admin = $uiAdmin({
    pages: [
      this.users.adminUsers,
      this.users.adminUserLayout,
      this.sessions.adminSessions,
    ],
    sidebarItems: [
      this.users.adminUsers,
      this.sessions.adminSessions,
    ],
  });

  // ── Admin Dashboard ─────────────────────────────
  adminDashboard = $page({
    parent: this.admin,
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
