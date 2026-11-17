import { formatReference } from "@lore/core/web";
import { ReleasePublishGuards } from "@lore/plan/api";
import { $inject } from "alepha";
import { ConflictError } from "alepha/server";

import { RequirementCoverageService } from "./RequirementCoverageService.ts";

/**
 * Plan's `blockFailingMust` (#E153, #Q3774): with it and `requirements` on,
 * publishing a release whose Must requirements fail is refused, naming
 * them. Off, which is the default, readiness is a warning only and the
 * publish goes through unchanged.
 */
export class RequirementsReleaseGuard {
  protected readonly guards = $inject(ReleasePublishGuards);
  protected readonly coverage = $inject(RequirementCoverageService);

  constructor() {
    this.guards.register({
      name: "requirements",
      check: async (release) => {
        if (!(await this.coverage.blocks(release.projectId))) return;
        const readiness = await this.coverage.readiness(
          release.projectId,
          release.id,
        );
        if (readiness.failingMust.length === 0) return;
        throw new ConflictError(
          `Release ${release.tag ?? release.title} has failing Must requirements: ${readiness.failingMust
            .map((it) => formatReference("requirement", it.number))
            .join(
              ", ",
            )}. Fix them, or turn off "Block a release on a failing Must" in Plan's settings.`,
        );
      },
    });
  }
}
