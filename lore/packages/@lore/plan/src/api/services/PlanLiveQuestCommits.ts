import { LiveQuestRegistry, type RecordedQuestCommits } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";

/**
 * Plan's half of live quests (#E154): the commits recorded on each quest, for
 * Ship to match against the shas a push walked and to count what a deployed
 * copy is behind. Registered on the core registry, so Ship never reads a quest
 * row itself.
 */
export class PlanLiveQuestCommits {
  protected readonly registry = $inject(LiveQuestRegistry);
  protected readonly quests = $repository(quests);

  constructor() {
    this.registry.registerCommits((projectId) => this.recorded(projectId));
  }

  /**
   * Every quest of the project with at least one recorded commit. Narrow
   * columns: a project holds thousands of quests and this runs on every push.
   */
  protected async recorded(projectId: number): Promise<RecordedQuestCommits[]> {
    const rows = await this.quests.findMany({
      where: {
        projectId: { eq: projectId },
        commits: { isNotNull: true },
      },
      columns: ["shortId", "commits", "completedAt"],
    });
    return rows.flatMap((row) => {
      const shas = (row.commits ?? [])
        .map((commit) => commit.sha.toLowerCase())
        .filter((sha) => sha.length >= 7);
      return shas.length === 0
        ? []
        : [
            {
              number: row.shortId,
              shas,
              completed: row.completedAt != null,
              ...(row.completedAt ? { completedAt: row.completedAt } : {}),
            },
          ];
    });
  }
}
