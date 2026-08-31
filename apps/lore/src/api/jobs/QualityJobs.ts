import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { ProjectLimits } from "../services/ProjectLimits.ts";
import { QualityService } from "../services/QualityService.ts";

/**
 * Keeps `quality_runs` from growing without bound.
 *
 * ## Why a row cap rather than a ttl
 *
 * A count is the honest unit. What makes a project's table big is how many
 * branches it pushes from, not how old its first push was, and a busy
 * repository and a quiet one should not be held to the same calendar.
 *
 * The cap lives on `ProjectLimits`, the `$parameter` named
 * `lore.campaign.limits`, so an admin bumps it from `/admin/parameters` with
 * no redeploy.
 *
 * ## ⚠️ It has very little to do since runs became daily
 *
 * One row per branch per day means the default cap of 500 is over a year of
 * `main`. The sweep earns its keep on a project pushing from many branches,
 * and is a no-op on every other one - which is the intended steady state, not
 * a sign it should be deleted.
 */
export class QualityJobs {
  protected readonly log = $logger();
  protected readonly quality = $inject(QualityService);
  protected readonly limits = $inject(ProjectLimits);

  /**
   * Nightly, and off the hour: a cap is a steady-state target, so there is
   * nothing to gain from sweeping often and something to lose from sweeping
   * while a CI job is pushing.
   */
  public readonly pruneQualityRuns = $job({
    cron: "17 3 * * *",
    handler: async () => {
      const cap = await this.limits.maxQualityRunsPerProject();
      const projects = await this.quality.projectsWithRuns();

      let removed = 0;
      for (const projectId of projects) {
        removed += await this.quality.prune(projectId, cap);
      }

      if (removed > 0) {
        this.log.info(
          `Pruned ${removed} quality run(s) past the cap of ${cap}`,
          { projects: projects.length },
        );
      }
    },
  });
}
