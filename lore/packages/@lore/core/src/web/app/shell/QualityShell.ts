import { $inject } from "alepha";

import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";
import { ReportsTabRegistry } from "../registries/ReportsTabRegistry.ts";
import { capabilityOption } from "../services/projectCapabilities.ts";

/**
 * Quality's part of the project shell, a part of Reports since Build went
 * (#Q4217): the Quality tab of Reports and General's Quality settings tab
 * (#Q4059), both shown while Reports' `quality` option is on.
 */
export class QualityShell {
  protected readonly reports = $inject(ReportsTabRegistry);
  protected readonly shell = $inject(ProjectShellRegistry);

  constructor() {
    // Quality is its own tab (#Q3070), right after Delivery. It shows with
    // the option on, with the push command until CI sends a run; a project
    // with the option off shows none, not even the empty state.
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 9.85,
      needs: "reports",
      option: "quality",
      filters: ["period", "branch"],
    });

    this.shell.registerSettingsTab("general", {
      route: "projectSettingsQuality",
      labelKey: "project.settings.tab.quality",
      capability: "reports",
      visible: (project) => capabilityOption(project, "reports", "quality"),
    });
  }
}
