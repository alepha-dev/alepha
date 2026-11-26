import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { deployments } from "../entities/deployments.ts";

/**
 * The window an error series is drawn over, and the deploys marked on it:
 * what the dashboard's error trend and one error's trend share (#E185), so
 * the day list and the deployment read exist once.
 */
export class ErrorSeriesWindow {
  protected readonly DAY_MS = 86_400_000;
  /**
   * The most markers one chart carries.
   */
  protected readonly MAX_DEPLOYS = 50;

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly deployments = $repository(deployments);

  /**
   * The last `windowDays` days, oldest first, today included, as
   * `YYYY-MM-DD`. The caller zero-fills its series over them: only it knows
   * the window.
   */
  public days(windowDays: number): string[] {
    const today = this.dateTime.nowMillis();
    return Array.from({ length: windowDays }, (_, index) =>
      new Date(today - (windowDays - 1 - index) * this.DAY_MS)
        .toISOString()
        .slice(0, 10),
    );
  }

  /**
   * The project's deployments that succeeded since `firstDay`, oldest
   * first, each as a marker at the moment it finished.
   *
   * Never `log`, which holds a whole deploy log per row (#Q2682).
   */
  public async deploys(
    projectId: number,
    firstDay: string,
  ): Promise<Array<{ at: string; kind: "deploy" }>> {
    const deployed = await this.deployments.findMany({
      columns: ["createdAt", "finishedAt"],
      where: {
        projectId: { eq: projectId },
        status: { eq: "succeeded" },
        createdAt: { gte: `${firstDay}T00:00:00.000Z` },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: this.MAX_DEPLOYS,
    });
    return deployed.map((it) => ({
      at: it.finishedAt ?? it.createdAt,
      kind: "deploy" as const,
    }));
  }
}
