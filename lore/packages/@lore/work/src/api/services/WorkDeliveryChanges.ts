import { type DeliveryChange, DeliveryChangeRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

/**
 * Work's half of lead time for changes (#Q3008): what completed in a window,
 * with the release tag and the commits that place it in a deploy.
 */
export class WorkDeliveryChanges {
  protected readonly registry = $inject(DeliveryChangeRegistry);
  protected readonly quests = $repository(quests);
  protected readonly releases = $repository(releases);

  constructor() {
    this.registry.register((projectId, window) =>
      this.changes(projectId, window),
    );
  }

  protected async changes(
    projectId: number,
    window: { from?: string; to?: string },
  ): Promise<DeliveryChange[]> {
    const [rows, tags] = await Promise.all([
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          completedAt: {
            isNotNull: true,
            ...(window.from ? { gte: window.from } : {}),
            ...(window.to ? { lte: window.to } : {}),
          },
        },
        columns: ["completedAt", "releaseId", "commits"],
      }),
      this.releases.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "tag"],
      }),
    ]);
    const tagOf = new Map(tags.map((row) => [row.id, row.tag]));
    return rows.flatMap((row) => {
      const tag = row.releaseId ? tagOf.get(row.releaseId) : undefined;
      return row.completedAt
        ? [
            {
              completedAt: row.completedAt,
              ...(tag ? { tag } : {}),
              commits: (row.commits ?? []).map((commit) => commit.sha),
            },
          ]
        : [];
    });
  }
}
