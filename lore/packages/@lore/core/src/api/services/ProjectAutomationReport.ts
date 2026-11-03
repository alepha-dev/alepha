import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { automationRuns } from "../entities/automationRuns.ts";
import { automations } from "../entities/automations.ts";
import type { ReportsQuery } from "../schemas/reportsQuerySchema.ts";
import type { ReportsTeam } from "../schemas/reportsTeamSchema.ts";
import { ReportStatistics } from "./ReportStatistics.ts";

/**
 * The automations half of the Team tab (#Q3014): how the project's rules ran
 * in the period, and which are broken. Run rows are kept 30 days in detail, so
 * a longer period reads what is left, newest first.
 */
export class ProjectAutomationReport {
  protected readonly runs = $repository(automationRuns);
  protected readonly rules = $repository(automations);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * A run still going has not ended, and a skipped one did no work: neither
   * says anything about whether rules succeed.
   */
  protected readonly unfinished = ["queued", "running", "skipped"];

  async read(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsTeam["automations"]> {
    const createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    const [runs, broken] = await Promise.all([
      this.runs.findMany({
        where: {
          projectId: { eq: projectId },
          ...(query.from || query.to ? { createdAt } : {}),
        },
        columns: ["status", "triggeredAt", "finishedAt"],
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 5000,
      }),
      this.rules.findMany({
        where: { projectId: { eq: projectId }, health: { eq: "broken" } },
        columns: ["id", "title"],
        orderBy: "title",
        limit: 50,
      }),
    ]);

    const statuses = new Map<string, number>();
    for (const run of runs) {
      statuses.set(run.status, (statuses.get(run.status) ?? 0) + 1);
    }
    const finished = runs.filter(
      (run) => !this.unfinished.includes(run.status),
    );
    const seconds = finished.flatMap((run) =>
      run.finishedAt
        ? [
            (this.dt.of(run.finishedAt).valueOf() -
              this.dt.of(run.triggeredAt).valueOf()) /
              1000,
          ]
        : [],
    );

    return {
      runs: [...statuses]
        .map(([status, count]) => ({ status, count }))
        .toSorted((a, b) => b.count - a.count),
      finished: finished.length,
      succeeded: statuses.get("succeeded") ?? 0,
      medianSeconds: this.stats.median(seconds),
      p85Seconds: this.stats.percentile(seconds, 85),
      broken: broken.map((rule) => ({ id: rule.id, title: rule.title })),
    };
  }
}
