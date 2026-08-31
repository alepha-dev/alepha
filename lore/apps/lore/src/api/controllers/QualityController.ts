import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import type { QualityRun } from "../entities/qualityRuns.ts";
import { qualityOverviewSchema } from "../schemas/qualityOverviewSchema.ts";
import { qualityRunPushSchema } from "../schemas/qualityRunPushSchema.ts";
import { qualityRunSchema } from "../schemas/qualityRunSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { QualityService } from "../services/QualityService.ts";

/**
 * The endpoint a CI job pushes a test run into, and the one the Reports
 * Quality tab reads back.
 *
 * ## ⚠️ Action names are the wire contract here
 *
 * `@alepha/lore/cli` calls {@link QualityController.pushQualityRun} through
 * `$client<QualityController>()`, which resolves an action **by name** against
 * the registry the remote serves at `/api/_links`. The type moves with a
 * rename and typecheck follows it, but the deployed Lore does not: a renamed
 * action answers an old CLI with `Action not found`. Rename either of these
 * only on purpose.
 *
 * ## The gate is membership, not ownership
 *
 * `$ownsProject({ param: "projectId" })` with no `owner: true`. Folio #1133's
 * rule decides it: pushing a run is the work, not the project's
 * configuration.
 */
export class QualityController {
  protected readonly quality = $inject(QualityService);

  /**
   * Declared above the actions on purpose: a `use: [...]` entry reading
   * another field is a field initializer, so a gate declared below its first
   * use is `undefined` at construction time.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  /**
   * How much history one read hands the tab. With one row per branch per day,
   * a year of daily pushes fits, and the graphs stop being readable long
   * before the limit bites.
   */
  protected static readonly SERIES_LIMIT = 365;

  /**
   * Record what a CI run measured, replacing whatever that branch already
   * pushed today.
   *
   * ## ⚠️ Accepted while `features.quality` is off
   *
   * There is no feature check here and that is the decision, not an oversight.
   * The flag gates the TAB. A push refused because someone flipped a switch in
   * the UI turns a build red for a reason that has nothing to do with the
   * build, and the person who flipped it would never connect the two.
   *
   * A failed push exits non-zero on the CLI side. The safety is where the
   * command runs: the push step is `continue-on-error` and gates no deploy, so
   * a red push shows as a warning annotation rather than blocking anything.
   */
  pushQualityRun = $action({
    use: [$secure(), this.ownsProject()],
    method: "POST",
    path: "/projects/:projectId/quality/runs",
    description: "Record coverage and test totals for one commit.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: qualityRunPushSchema,
      response: qualityRunSchema,
    },
    handler: async ({ params, body }) => {
      const run = await this.quality.record({
        projectId: params.projectId,
        commitSha: body.commitSha,
        branch: body.branch,
        coverage: body.coverage,
        tests: body.tests,
        durationMs: body.durationMs,
      });

      return this.resource(run);
    },
  });

  /**
   * The latest run on the default branch plus the series behind it.
   *
   * One action rather than two because the tab renders both together, and a
   * project with no runs at all is a normal answer rather than a 404: that
   * empty response is what the "nothing pushed yet" panel is for.
   */
  getQualityRuns = $action({
    use: [$secure(), this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/quality/runs",
    description: "The latest quality run and the series behind it.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        /**
         * Which branch the headline figures come from. `main` unless asked,
         * so a topic branch's push never displaces it on the tab.
         */
        branch: z.string().max(200).optional(),
      }),
      response: qualityOverviewSchema,
    },
    handler: async ({ params, query }) => {
      const [latest, runs] = await Promise.all([
        this.quality.findLatest(params.projectId, query.branch ?? "main"),
        this.quality.findSeries(
          params.projectId,
          QualityController.SERIES_LIMIT,
        ),
      ]);

      // A project may have pushed only from a topic branch, in which case the
      // branch-scoped `latest` is empty while the series is not. Falling back
      // to the newest row overall is better than a tab that renders a graph
      // above four blank figures.
      const headline = latest ?? runs[0];

      return {
        latest: headline ? this.resource(headline) : undefined,
        runs: runs.map((run) => this.resource(run)),
      };
    },
  });

  /**
   * The row, flattened to what the API returns.
   */
  protected resource(run: QualityRun) {
    return {
      id: run.id,
      projectId: run.projectId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      day: run.day,
      commitSha: run.commitSha,
      branch: run.branch,
      coverageLines: run.coverageLines,
      coverageStatements: run.coverageStatements,
      coverageFunctions: run.coverageFunctions,
      coverageBranches: run.coverageBranches,
      testsTotal: run.testsTotal,
      testsPassed: run.testsPassed,
      testsFailed: run.testsFailed,
      testsSkipped: run.testsSkipped,
      durationMs: run.durationMs,
    };
  }
}
