import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * One row per push: what a CI run measured about a project's test suite.
 *
 * Deliberately not an `artifact` (#1199). That table is deploy-shaped, unique
 * on `(projectId, app, tag, runtime)` and sha256-addressed, with `latest`
 * mutable in place. A coverage report has no runtime, and its "tag" is a
 * commit sha rather than a version. Bending a schema two other epics depend on
 * so it could also hold this was the wrong trade, so this module owns its own
 * table and its own storage instead.
 *
 * ## Totals here, the reports behind a fileId
 *
 * The four percentages and the four counts are relational because the graphs
 * read them on every page load and a JSON parse per point is not free. The raw
 * `json-summary` and vitest test report stay opaque in `QualityService.BUCKET`,
 * which is what makes per-file coverage and PR diff annotations later a
 * server-side parse of history that already exists, with no CI re-run.
 *
 * ## ⚠️ No unique index on `commitSha`, on purpose
 *
 * Two pushes for the same commit APPEND. A unique index would turn a
 * legitimate CI re-run into a 409, and a re-run of a flaky suite is
 * information rather than noise. `latest` is therefore the newest row on the
 * branch, ordered by `createdAt`, and never "the row for this sha".
 *
 * ## ⚠️ `fileId` is a logical reference, with no foreign key
 *
 * Exactly the `folio_blobs.fileId` shape, and for the same reason: adding the
 * constraint means a table rebuild, and a rebuild on D1 is the cascade wipe
 * this app has already been bitten by once (see "Migration safety on D1" in
 * `apps/lore/CLAUDE.md`).
 *
 * Two consequences, both of which are `QualityService`'s job rather than the
 * database's:
 *
 * 1. Deleting a row directly orphans its bytes in the bucket forever. Removal
 *    goes through `QualityService.delete`, and nothing else.
 * 2. The reference can dangle the other way too. The read path returns the run
 *    WITHOUT its raw report rather than throwing, because the totals are the
 *    part the tab renders.
 *
 * `projectId` IS physical and DOES cascade: wiping a project wipes its runs.
 * The bytes those rows pointed at are then orphaned, which is the accepted
 * cost of not rebuilding `projects`.
 */
export const qualityRuns = $entity({
  name: "quality_runs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The commit the suite ran against. Not unique, and not a key: see the
     * append rule above. Sized for a full sha with room for a short one.
     */
    commitSha: z.string().min(7).max(40),
    /**
     * The branch the run happened on. `latest` is scoped by it, so a topic
     * branch's numbers never displace `main`'s on the tab.
     */
    branch: z.string().min(1).max(200),
    coverageLines: z.number().min(0).max(100),
    coverageStatements: z.number().min(0).max(100),
    coverageFunctions: z.number().min(0).max(100),
    coverageBranches: z.number().min(0).max(100),
    testsTotal: z.integer().min(0),
    testsPassed: z.integer().min(0),
    testsFailed: z.integer().min(0),
    /**
     * ⚠️ The SUM of the vitest report's `numPendingTests` (skipped) and
     * `numTodoTests`. Two sources, one column: read it as "did not run", not
     * as `numPendingTests` alone.
     */
    testsSkipped: z.integer().min(0),
    /**
     * ⚠️ Derived, not reported. The vitest JSON report has no top-level
     * duration field: the CLI computes it as the maximum per-file `endTime`
     * minus the run's `startTime`.
     */
    durationMs: z.integer().min(0),
    /**
     * The `files` row holding the raw `json-summary` and test report, in
     * `QualityService.BUCKET`. Optional because it can dangle, and because a
     * caller is allowed to push totals without the reports behind them.
     */
    fileId: z.uuid().optional(),
  }),
  indexes: [
    // The tab's two queries: the series for a project, and the newest row on
    // one branch. Both are covered by ordering on `createdAt` within them.
    { columns: ["projectId", "createdAt"] },
    { columns: ["projectId", "branch", "createdAt"] },
  ],
});

export type QualityRun = Infer<typeof qualityRuns.schema>;
