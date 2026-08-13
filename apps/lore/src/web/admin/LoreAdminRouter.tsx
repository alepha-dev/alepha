import { $pageAdmin } from "@alepha/ui/components/admin/admin-router-page";
import { $client } from "alepha/server/links";
import { FolderKanban } from "lucide-react";
import type { AdminProjectController } from "@/api/controllers/AdminProjectController.ts";

/**
 * Lore's own pages inside the shared admin shell.
 *
 * `$pageAdmin` parents each one onto `AdminRouter`'s `/admin` layout and
 * registers the router, so this class is the whole integration — Lore adds a
 * page to a sidebar `@alepha/ui` owns without either side importing the
 * other's routes.
 *
 * `order: 100` and a group of Lore's own keep these clear of the built-ins,
 * which occupy `Identity` (1-3) and `Operations` (4-9); `useNavEntries` sorts
 * groups by their smallest member, so a lower order would reshuffle them.
 */
export class LoreAdminRouter {
  protected readonly projectApi = $client<AdminProjectController>();

  /**
   * Gated on the action rather than on `admin:project:read` alone. The
   * permission is declared by this page's own `$secure`, so an admin holding
   * the `*` wildcard would be granted it whether or not the controller
   * behind it exists — the entry would sit in the sidebar over a dead API.
   */
  adminProjects = $pageAdmin({
    path: "/projects",
    head: { title: "Projects" },
    nav: {
      label: "Projects",
      icon: <FolderKanban />,
      group: "Lore",
      order: 100,
    },
    can: () => this.projectApi.findProjects.can(),
    lazy: () => import("./AdminProjects.tsx"),
  });
}
