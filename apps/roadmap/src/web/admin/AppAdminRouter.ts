import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import {
  Bell,
  Files,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UsersIcon,
} from "lucide-react";
import { createElement } from "react";

/**
 * Admin shell. Each leaf page mounts an `@alepha/ui` admin block. Sidebar is
 * grouped Identity / Operations to mirror the playground; only features the
 * realm enables (`apiKeys`, `audits`, `jobs`, `notifications`, `avatars`)
 * are wired here.
 */
export class AppAdminRouter {
  adminLayout = $page({
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    component: () =>
      createElement(AppShell, {
        nav: [
          {
            label: "Identity",
            items: [
              { href: "/admin/users", label: "Users", icon: UsersIcon },
              {
                href: "/admin/sessions",
                label: "Sessions",
                icon: ShieldCheck,
              },
              { href: "/admin/keys", label: "API keys", icon: KeyRound },
            ],
          },
          {
            label: "Operations",
            items: [
              { href: "/admin/jobs", label: "Jobs", icon: Timer },
              {
                href: "/admin/notifications",
                label: "Notifications",
                icon: Bell,
              },
              {
                href: "/admin/audits",
                label: "Audit log",
                icon: ShieldAlert,
              },
              { href: "/admin/files", label: "Files", icon: Files },
            ],
          },
        ],
      }),
  });

  adminUsers = $page({
    path: "/users",
    head: { title: "Users" },
    component: AdminUsers,
    parent: this.adminLayout,
  });

  adminSessions = $page({
    path: "/sessions",
    head: { title: "Sessions" },
    component: AdminSessions,
    parent: this.adminLayout,
  });

  adminKeys = $page({
    path: "/keys",
    head: { title: "API keys" },
    component: AdminKeys,
    parent: this.adminLayout,
  });

  adminJobs = $page({
    path: "/jobs",
    head: { title: "Jobs" },
    component: AdminJobs,
    parent: this.adminLayout,
  });

  adminNotifications = $page({
    path: "/notifications",
    head: { title: "Notifications" },
    component: AdminNotifications,
    parent: this.adminLayout,
  });

  adminAudits = $page({
    path: "/audits",
    head: { title: "Audit log" },
    component: AdminAudits,
    parent: this.adminLayout,
  });

  adminFiles = $page({
    path: "/files",
    head: { title: "Files" },
    component: AdminFiles,
    parent: this.adminLayout,
  });
}
