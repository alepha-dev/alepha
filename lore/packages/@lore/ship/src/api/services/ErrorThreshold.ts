import { HourlyChecks, ProjectEvents, ProjectThresholds } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";
import { ShipProjectEvents } from "./ShipProjectEvents.ts";

/**
 * The open-errors threshold (#Q3894), checked by the hourly job: one count
 * for the projects that set one, over it records `errors.threshold_crossed`,
 * once, through core's {@link ProjectThresholds}. The error ingest path is
 * not touched. Coverage, the other threshold, is Build's since #E162.
 */
export class ErrorThreshold {
  protected readonly thresholds = $inject(ProjectThresholds);
  protected readonly errors = $repository(projectErrors);
  protected readonly projects = $repository(projects);
  protected readonly events = $inject(ProjectEvents);
  protected readonly definitions = $inject(ShipProjectEvents);
  protected readonly checks = $inject(HourlyChecks);

  constructor() {
    this.checks.register({
      name: "errors.threshold",
      run: async () => {
        await this.checkErrors();
      },
    });
  }

  /**
   * The hourly check: one read of the projects that set an open-errors
   * threshold, each with its open count. Answers how many alerts fired.
   */
  public async checkErrors(): Promise<number> {
    let fired = 0;
    for (const row of await this.thresholds.withOpenErrorsMax()) {
      const open = await this.errors.count({
        projectId: row.projectId,
        status: "open",
      });
      if (open <= row.openErrorsMax!) {
        await this.thresholds.rearm(row, "errorsArmed");
        continue;
      }
      if (row.errorsArmed === false) continue;
      const project = await this.projects.getById(row.projectId);
      if (
        await this.thresholds.fire(
          row,
          "errorsArmed",
          await this.events.emit({
            projectId: row.projectId,
            name: "errors.threshold_crossed",
            subjectId: row.projectId,
            fields: {
              project: project.title,
              title: project.title,
              count: open,
              threshold: row.openErrorsMax!,
              url: `/${project.slug || `project-${project.id}`}/errors`,
            },
          }),
        )
      )
        fired++;
    }
    return fired;
  }
}
