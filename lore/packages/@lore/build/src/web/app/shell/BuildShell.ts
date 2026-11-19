import { ReportsTabRegistry } from "@lore/core/web";
import { $inject } from "alepha";

/**
 * Build's part of the project shell (#E162): the Quality tab of Reports.
 */
export class BuildShell {
  protected readonly reports = $inject(ReportsTabRegistry);

  constructor() {
    // Quality is its own tab (#Q3070), right after Delivery. It shows for
    // every Build project, with the push command until CI sends a run; a
    // project without Build shows none, not even the empty state (#E162).
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 9.85,
      needs: "build",
      filters: ["period", "branch"],
    });
  }
}
