import { $inject } from "alepha";

import type { ProjectEventFields } from "../schemas/projectEventFieldsSchema.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";

/**
 * The agent automations' project events (#Q4230): Core, like the hosts they
 * run on, so members and channels subscribe to them whatever the project's
 * capabilities. Read with `host:read`, as the automations are.
 */
export class AutomationProjectEvents {
  protected static readonly DEFINITIONS = [
    {
      name: "automation.disabled",
      label: "Automation disabled",
      title: "disabled itself",
      text: "It failed three times in a row. Read its last job, then enable it again.",
    },
    {
      name: "automation.run.failed",
      label: "Automation run failed",
      title: "had a run fail",
      text: "Read the job's log for why.",
    },
    {
      name: "automation.ceiling.reached",
      label: "Automation ceiling reached",
      title: "reached a ceiling",
      text: "It starts nothing more until the window passes or the ceiling is raised.",
    },
  ] as const;

  protected readonly catalog = $inject(ProjectEventCatalog);

  constructor() {
    for (const definition of AutomationProjectEvents.DEFINITIONS)
      this.catalog.register({
        name: definition.name,
        label: definition.label,
        resource: "automations",
        subject: "automation",
        fields: {
          automation_id: "text",
          automation: "text",
          job_id: "text",
          reason: "text",
        },
        permission: "host:read",
        message: (it) => ({
          title: `Automation ${this.text(it, "automation")} ${definition.title}`,
          text: [this.text(it, "reason"), definition.text]
            .filter(Boolean)
            .join(" "),
        }),
      });
  }

  protected text(fields: ProjectEventFields, key: string): string {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  }
}
