import { DashboardCardService, DashboardScopeService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { epics } from "../entities/epics.ts";
import { releases } from "../entities/releases.ts";

/**
 * Work's part of the dashboard, registered on core (#E75, #Q2623): how a
 * card's `epic` and `release` scopes are proven, and the quests and feedback
 * cards a fresh board starts with.
 */
export class WorkDashboard {
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly cards = $inject(DashboardCardService);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);

  constructor() {
    this.cards.registerSeed({
      order: 20,
      cards: async () => [
        { metric: "activeQuests", scope: { kind: "all" as const } },
      ],
    });
    this.cards.registerSeed({
      order: 40,
      cards: async () => [
        { metric: "untriagedFeedback", scope: { kind: "all" as const } },
      ],
    });

    this.scopes.registerScope("epic", async (scope, visibleById) => {
      const epic = await this.epics.findOne({
        where: { id: { eq: scope.epicId! } },
      });
      // Two ways to fail, one answer, exactly as for an app: the epic does
      // not exist, or it belongs to a project the caller has nothing to do
      // with. "No such epic here" is true either way, and distinguishing them
      // would leak the second.
      if (!epic || !visibleById.has(epic.projectId)) {
        throw new NotFoundError("Epic not found");
      }
      return [
        {
          kind: "epic",
          id: String(epic.id),
          projectId: epic.projectId,
          name: epic.title,
          row: epic,
        },
      ];
    });

    this.scopes.registerScope("release", async (scope, visibleById) => {
      const release = await this.releases.findOne({
        where: { id: { eq: scope.releaseId! } },
      });
      if (!release || !visibleById.has(release.projectId)) {
        throw new NotFoundError("Release not found");
      }
      return [
        {
          kind: "release",
          id: String(release.id),
          projectId: release.projectId,
          // The TAG, not the title, matching how a release is named
          // everywhere else in the app and in its own URL.
          name: release.tag ?? release.title,
          row: release,
        },
      ];
    });
  }
}
