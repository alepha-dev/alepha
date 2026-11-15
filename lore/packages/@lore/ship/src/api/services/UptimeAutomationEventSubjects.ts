import { AutomationEventSubjects } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";
import { UptimeAutomationFields } from "./UptimeAutomationFields.ts";

/**
 * The subject a `monitor.*` rule is previewed against (#Q3610): a monitor,
 * by id, and its latest incident, closed for `monitor.up`.
 */
export class UptimeAutomationEventSubjects {
  protected readonly registry = $inject(AutomationEventSubjects);
  protected readonly projects = $repository(projects);
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly fields = $inject(UptimeAutomationFields);
  constructor() {
    for (const kind of ["down", "up"] as const)
      this.registry.register(`monitor.${kind}`, (projectId, id) =>
        this.subject(projectId, id, kind),
      );
  }
  protected async subject(
    projectId: number,
    id: string | number,
    kind: "down" | "up",
  ) {
    if (typeof id !== "string")
      throw new BadRequestError("Monitor subjects require a monitor UUID");
    const monitor = await this.monitors.getOne({ where: { projectId, id } });
    const [incident] = await this.incidents.findMany({
      where: {
        monitorId: monitor.id,
        ...(kind === "up" ? { endedAt: { isNotNull: true } } : {}),
      },
      orderBy: [{ column: "startedAt", direction: "desc" }],
      limit: 1,
    });
    if (!incident)
      throw new NotFoundError(
        kind === "up"
          ? "This monitor has no recovered incident yet"
          : "This monitor has no incident yet",
      );
    const project = await this.projects.getById(projectId);
    return this.fields.build(project, monitor, incident, kind);
  }
}
