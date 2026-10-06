import { DashboardCardService, DashboardScopeService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { sigils } from "../entities/sigils.ts";

/**
 * Deploy's part of the dashboard, registered on core (#E75, #Q2623): how a
 * card's `apps` scope is proven, and the visitors and blights cards a fresh
 * board starts with.
 */
export class DeployDashboard {
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly cards = $inject(DashboardCardService);
  protected readonly sigils = $repository(sigils);

  constructor() {
    // Yesterday's visitors, when the user actually has an app that reports
    // them: the first beacon-carrying app. Beacon and not merely "an app":
    // the visitors metric reads page traffic, an app without the `beacon`
    // kind reports none, and its analytics page 404s, so the card could not
    // even be clicked.
    this.cards.registerSeed({
      order: 10,
      cards: async (_user, visible) => {
        if (visible.length === 0) return [];
        const rows = await this.sigils.findMany({
          where: { projectId: { inArray: visible.map((it) => it.id) } },
          orderBy: [{ column: "createdAt", direction: "asc" }],
        });
        const beacon = rows.find((it) => it.kinds?.includes("beacon"))?.id;
        return beacon
          ? [
              {
                metric: "uniqueVisitors",
                scope: { kind: "apps" as const, sigilIds: [beacon] },
              },
            ]
          : [];
      },
    });
    this.cards.registerSeed({
      order: 30,
      cards: async () => [
        { metric: "openBlights", scope: { kind: "all" as const } },
      ],
    });

    this.scopes.registerScope("apps", async (scope, visibleById) => {
      const ids = scope.sigilIds ?? [];
      // ⚠️ D1, and one bound parameter per app — but bounded already, and by
      // the schema rather than by anything here: `dashboardScopeSchema` caps
      // `sigilIds` at 50, well under D1's hundred-parameter ceiling (folio
      // #F1173). Said out loud because the cap is a validation rule two files
      // away, and raising it past 90 would break this read with no error
      // anyone reads until a card with that many apps is resolved.
      const rows = await this.sigils.findMany({
        where: { id: { inArray: ids } },
      });
      const byId = new Map(rows.map((it) => [it.id, it]));
      return ids.map((id) => {
        const sigil = byId.get(id);
        // Two ways to fail, one answer: the app does not exist, or it exists
        // in a project the caller has nothing to do with. "No such app here"
        // is true either way, and distinguishing them would leak the second.
        if (!sigil || !visibleById.has(sigil.projectId)) {
          throw new NotFoundError("App not found");
        }
        return {
          kind: "app",
          id: sigil.id,
          projectId: sigil.projectId,
          name: sigil.name,
          row: sigil,
        };
      });
    });
  }
}
