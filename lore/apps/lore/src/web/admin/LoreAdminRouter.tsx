import { $pageAdmin } from "@alepha/ui/admin";
import { $client } from "alepha/server/links";
import { FolderKanban, Plug, Server } from "lucide-react";

import type { AdminEstateController } from "@/api/controllers/AdminEstateController.ts";
import type { AdminMcpController } from "@/api/controllers/AdminMcpController.ts";
import type { AdminProjectController } from "@/api/controllers/AdminProjectController.ts";

/**
 * Lore's own pages inside the shared admin shell.
 *
 * `$pageAdmin` parents each one onto `AdminRouter`'s `/admin` layout and
 * registers the router, so this class is the whole integration — Lore adds a
 * page to a sidebar `@alepha/ui` owns without either side importing the
 * other's routes.
 *
 * `order: 100` and a group of Lore's own put these **above** the built-ins,
 * which are parked in a reserved high band — `Identity` (1000-1003) and
 * `System` (1010-1016); `useNavEntries` sorts groups by their smallest member,
 * so anything below 1000 leads.
 */
export class LoreAdminRouter {
  protected readonly projectApi = $client<AdminProjectController>();
  protected readonly estateApi = $client<AdminEstateController>();
  protected readonly mcpApi = $client<AdminMcpController>();
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

  /**
   * Every estate on the instance, the backstop for one whose owner is gone
   * (#1838). Same gate as above: the action, so the entry never sits over a
   * dead API. Reads no credential; the admin role gets no exception.
   */
  adminEstates = $pageAdmin({
    path: "/estates",
    head: { title: "Estates" },
    nav: {
      label: "Estates",
      icon: <Server />,
      group: "Lore",
      order: 102,
    },
    can: () => this.estateApi.findEstates.can(),
    lazy: () => import("./AdminEstates.tsx"),
  });

  /**
   * What the MCP surface is asked for, over time (#E65).
   *
   * Admin rather than a project page: a tool call is not scoped to a project
   * - `project_list` has none - and the audience is whoever maintains the
   * tool descriptions. Same gate shape as the two above: the action, so the
   * entry never sits over a dead API.
   */
  adminMcp = $pageAdmin({
    path: "/mcp",
    head: { title: "MCP" },
    nav: {
      label: "MCP",
      icon: <Plug />,
      group: "Lore",
      order: 104,
    },
    can: () => this.mcpApi.readMcpCalls.can(),
    lazy: () => import("./AdminMcp.client.tsx"),
  });
}
