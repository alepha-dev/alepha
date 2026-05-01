import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { AppShell } from "@alepha/ui/components/app-shell";
import { $page } from "alepha/react/router";
import { $secure } from "alepha/security";
import { UsersIcon } from "lucide-react";
import { createElement } from "react";

/**
 * Stub admin router. Full mantine-based admin routes were removed during the
 * @alepha/ui migration. Re-implement with @alepha/ui admin primitives if needed.
 */
export class AppAdminRouter {
  adminLayout = $page({
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    component: () =>
      createElement(AppShell, {
        nav: [
          {
            label: "Identity",
            items: [
              {
                icon: UsersIcon,
                label: "Users",
                href: "/admin/",
              },
            ],
          },
        ],
      }),
  });

  adminUsers = $page({
    path: "",
    component: AdminUsers,
    parent: this.adminLayout,
  });
}
