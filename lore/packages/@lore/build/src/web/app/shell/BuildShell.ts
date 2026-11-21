import {
  capabilityOption,
  ProjectShellRegistry,
  ReportsTabRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";

/**
 * Build's part of the project shell (#E162): the Quality tab of Reports, and
 * General's Quality settings tab (#Q4059).
 */
export class BuildShell {
  protected readonly reports = $inject(ReportsTabRegistry);
  protected readonly shell = $inject(ProjectShellRegistry);

  constructor() {
    // Quality is its own tab (#Q3070), right after Delivery. It shows for
    // every Build project, with the push command until CI sends a run; a
    // project without Build shows none, not even the empty state (#E162).
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 9.85,
      needs: "build",
      // Quality is an option of Build since #Q4005.
      option: "quality",
      filters: ["period", "branch"],
    });

    // The coverage settings (#Q4059): General's, since Build has no section
    // of its own, and listed while Quality is on.
    this.shell.registerSettingsTab("general", {
      route: "projectSettingsQuality",
      labelKey: "project.settings.tab.quality",
      capability: "build",
      visible: (project) => capabilityOption(project, "build", "quality"),
    });
  }
}
