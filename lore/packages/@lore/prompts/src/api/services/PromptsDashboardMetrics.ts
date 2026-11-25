import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { runningJobsFiltersSchema } from "../schemas/runningJobsFiltersSchema.ts";

/**
 * Prompts' dashboard tile (#Q4342): the agent jobs in flight. A run of
 * loose quests goes for hours, and nothing else on the board says it is
 * running. Declarative and browser-safe, like `DeployAppsDashboardMetrics`;
 * injected by `LorePromptsApi` and `LorePromptsWeb`.
 *
 * Read with `host:read`, like the Hosts card, and offered only while the
 * project has the `prompts` capability: off, no agent job runs.
 */
export class PromptsDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.catalog.register({
      key: "runningJobs",
      order: 86,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.runningJobs",
      hintKey: "dashboard.metric.runningJobs.hint",
      icon: "bot",
      presentation: "list",
      scopeKinds: ["projects"],
      filters: runningJobsFiltersSchema,
      requires: "host:read",
      needs: { capability: "prompts" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectSettingsPromptJobs",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
