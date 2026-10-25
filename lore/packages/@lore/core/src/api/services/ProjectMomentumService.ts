import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { ProjectAnalytics } from "../entities/projectAnalytics.ts";

/**
 * Daily activity per project, from the `project_activity` dataset: Home's
 * momentum strip and the dashboard's momentum tile (#Q2659) read it here, so
 * the two draw the same bars.
 *
 * `select: { count: "sum" }` because `$audit` coalesces a burst of identical
 * writes into one row carrying its count (see `HomeController.momentum`).
 *
 * ⚠️ It THROWS when the dataset cannot be read: on production it is an HTTP
 * call into Analytics Engine. Each caller decides what a failure costs: Home
 * renders without the bars, the tile fails, and neither ever draws fourteen
 * quiet days for a fortnight nobody measured.
 */
export class ProjectMomentumService {
  protected readonly datasets = $inject(ProjectAnalytics);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The last `count` days, oldest first, as UTC `YYYY-MM-DD`.
   */
  days(count: number): string[] {
    const today = this.dateTime.nowMillis();
    const dayMs = 24 * 60 * 60 * 1000;
    const labels: string[] = [];
    for (let back = count - 1; back >= 0; back--) {
      labels.push(new Date(today - back * dayMs).toISOString().slice(0, 10));
    }
    return labels;
  }

  /**
   * One count per day per project, zero-filled, in `days` order.
   */
  async read(
    projectIds: string[],
    days: string[],
  ): Promise<Array<{ projectId: number; counts: number[] }>> {
    const index = new Map(days.map((label, position) => [label, position]));
    const byProject = new Map<number, number[]>(
      projectIds.map((id) => [Number(id), days.map(() => 0)]),
    );

    const result = await this.datasets.activity.query({
      since: days[0],
      where: { project: { inArray: projectIds } },
      groupBy: ["day", "project"],
      select: { count: "sum" },
    });

    for (const row of result.rows) {
      const counts = byProject.get(Number(row.project));
      const position = index.get(String(row.day));
      // A bucket outside the labels is a boundary case, not an error: the
      // window is asked for by day and the labels are generated from the
      // clock, so the two can disagree by one at the edge.
      if (counts && position !== undefined) {
        counts[position] = Number(row.count) || 0;
      }
    }

    return [...byProject].map(([projectId, counts]) => ({
      projectId,
      counts,
    }));
  }
}
