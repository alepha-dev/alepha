import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { ProjectLimits } from "../services/ProjectLimits.ts";
import { QualityService } from "../services/QualityService.ts";

/**
 * Keeps `quality_runs` from growing without bound.
 *
 * ## Why a row cap rather than a `$storage` ttl
 *
 * A `ttl` on the reports storage was the first design, and it is the wrong
 * one. `api:files:purgeFiles` deletes rows and blobs hourly once past
 * `expirationDate`, so a TTL would destroy exactly the history that justifies
 * keeping the raw reports at all: the point of storing them is that per-file
 * coverage and PR diff annotations later become a parse of history that
 * already exists, with no CI re-run.
 *
 * A count is also the honest unit. What makes a project's table big is how
 * often it pushes, not how old its first push was, and a busy repository and a
 * quiet one should not be held to the same calendar.
 *
 * The cap lives on `ProjectLimits`, the `$parameter` named
 * `lore.campaign.limits`, so an admin bumps it from `/admin/parameters` with
 * no redeploy.
 *
 * ## ⚠️ It deletes through `QualityService`, never with its own `deleteMany`
 *
 * `quality_runs.fileId` carries no foreign key, so the database will not take
 * the raw report with the row. A sweep issuing its own delete would leave the
 * bytes in the bucket forever, paid for and unreachable - the bug
 * `folio_blobs` already shipped once.
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
