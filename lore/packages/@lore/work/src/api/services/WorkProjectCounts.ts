import { ProjectCountRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { AreaService } from "./AreaService.ts";
import { OpenQuestScope } from "./OpenQuestScope.ts";

/**
 * Work's per-project counts, registered on core's `ProjectCountRegistry`
 * (#E75, #Q2623): draft epics and pending feedback for the Home cards, areas
 * and open quests for the overview.
 *
 * Each count is what the project's sidebar badge counts, so the two never
 * disagree: `draft` epics only (the quests of a ready or in-progress epic are
 * already in the quest count), `pending` feedback.
 */
export class WorkProjectCounts {
  protected readonly counts = $inject(ProjectCountRegistry);
  protected readonly epicRows = $repository(epics);
  protected readonly feedbackRows = $repository(feedback);
  protected readonly areas = $inject(AreaService);
  protected readonly openQuests = $inject(OpenQuestScope);

  constructor() {
    const e = this.epicRows.table;
    const f = this.feedbackRows.table;
    // Raw SQL, so the soft delete the repositories apply is spelled out.
    this.counts.register({
      key: "draftEpics",
      select: () => sql`
        SELECT ${e.projectId} AS project_id, COUNT(*) AS n
        FROM ${e}
        WHERE ${e.projectId} IN (SELECT id FROM ids)
          AND ${e.status} = 'draft'
          AND ${e.deletedAt} IS NULL
        GROUP BY ${e.projectId}
      `,
    });
    this.counts.register({
      key: "pendingFeedback",
      select: () => sql`
        SELECT ${f.projectId} AS project_id, COUNT(*) AS n
        FROM ${f}
        WHERE ${f.projectId} IN (SELECT id FROM ids)
          AND ${f.status} = 'pending'
          AND ${f.deletedAt} IS NULL
        GROUP BY ${f.projectId}
      `,
    });
    this.counts.register({
      key: "areas",
      count: (ids) => this.areas.countByProjectIds([...ids]),
    });
    // The dashboard rail's per-project number. Counted through the same
    // scope as the sidebar badge and the Active Quests tile: all three are
    // visible together, and a disagreement between them is one of them lying
    // rather than a rounding difference.
    this.counts.register({
      key: "openQuests",
      count: (ids) => this.openQuests.countByProject([...ids]),
    });
  }
}
