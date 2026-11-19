import { ProjectEvents, ProjectThresholds } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { BuildProjectEvents } from "./BuildProjectEvents.ts";

/**
 * The coverage threshold (#Q3894), checked when a push on `main` arrives:
 * under it records `coverage.dropped`, once, through core's
 * {@link ProjectThresholds}; back over it rearms the alert. Build's since
 * #E162; the open-errors threshold is Ship's.
 */
export class CoverageThreshold {
  protected readonly thresholds = $inject(ProjectThresholds);
  protected readonly projects = $repository(projects);
  protected readonly events = $inject(ProjectEvents);
  protected readonly definitions = $inject(BuildProjectEvents);

  /**
   * A coverage push arrived. `previous` is the line coverage `main` had
   * before it. Answers whether `coverage.dropped` was recorded.
   */
  public async onCoverage(
    projectId: number,
    run: { branch: string; commitSha: string; lines: number },
    previous: number | undefined,
  ): Promise<boolean> {
    if (run.branch !== ProjectThresholds.BRANCH) return false;
    const row = await this.thresholds.get(projectId);
    if (row?.coverageMin === undefined || row.coverageMin === null)
      return false;
    if (run.lines >= row.coverageMin) {
      await this.thresholds.rearm(row, "coverageArmed");
      return false;
    }
    if (row.coverageArmed === false) return false;
    const project = await this.projects.getById(projectId);
    return this.thresholds.fire(
      row,
      "coverageArmed",
      await this.events.emit({
        projectId,
        name: "coverage.dropped",
        subjectId: run.commitSha,
        fields: {
          project: project.title,
          title: project.title,
          value: run.lines,
          previous: previous ?? null,
          threshold: row.coverageMin,
          branch: run.branch,
          commit: run.commitSha,
          url: `/${project.slug || `project-${project.id}`}/quality`,
        },
      }),
    );
  }
}
