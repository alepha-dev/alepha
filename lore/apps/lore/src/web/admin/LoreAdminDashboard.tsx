import {
  type AdminDashboardCard,
  adminRouterOptionsAtom,
} from "@alepha/ui/admin";
import type { AdminProjectController } from "@lore/core/api";
import { $hook, $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";

import { AdminProjectsTile } from "./AdminProjectsTile.tsx";

/**
 * Lore's tiles on the admin dashboard: today, the instance's projects.
 *
 * A class of its own, listed by the admin module, rather than a field of
 * `LoreAdminRouter`: registering the tile takes a `$hook`, and a class
 * holding pages must stay a pure controller (`test/pure-controllers.spec.ts`).
 */
export class LoreAdminDashboard {
  protected readonly alepha = $inject(Alepha);
  protected readonly projectApi = $client<AdminProjectController>();

  /**
   * The instance's projects. `order` below the built-ins' 1000 band, so it
   * leads the grid as an application's tile does.
   */
  public readonly projectsCard: AdminDashboardCard = {
    id: "lore-projects",
    title: "Projects",
    titleKey: "admin.projectsTile.title",
    description:
      "Projects on this instance, archived excluded, with creations against the week before.",
    descriptionKey: "admin.projectsTile.description",
    order: 100,
    can: () => this.projectApi.findProjects.can(),
    render: () => <AdminProjectsTile id="lore-projects" />,
  };

  /**
   * Adds {@link projectsCard} to the admin options both entry files set
   * (`main.server.ts`, `main.browser.ts`) before `start`. Here rather than in
   * `loreAdminOptions` because its gate reads this class's `$client`, and the
   * options are a plain object.
   */
  protected readonly registerCards = $hook({
    on: "configure",
    handler: () => {
      const options = this.alepha.store.get(adminRouterOptionsAtom) ?? {};
      const cards = options.dashboardCards ?? [];
      if (cards.some((card) => card.id === this.projectsCard.id)) {
        return;
      }
      this.alepha.store.set(adminRouterOptionsAtom, {
        ...options,
        dashboardCards: [...cards, this.projectsCard],
      });
    },
  });
}
