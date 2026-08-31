import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * What a CI run measured about a project's test suite: one row per project,
 * per branch, per UTC day.
 *
 * Deliberately not an `artifact` (#1199). That table is deploy-shaped, unique
 * on `(projectId, app, tag, runtime)` and sha256-addressed, with `latest`
 * mutable in place. A coverage report has no runtime, and its "tag" is a
 * commit sha rather than a version. Bending a schema two other epics depend on
 * so it could also hold this was the wrong trade, so this module owns its own
 * table instead.
 *
 * ## Totals, and nothing else
 *
 * The four percentages and the four counts are relational because the graphs
 * read them on every page load and a JSON parse per point is not free.
 *
 * The raw `json-summary` and vitest report used to be stored beside them, in a
 * bucket, behind a `fileId`. They are gone. A vitest report for a suite this
 * size is ~2.5 MB of per-test records that are overwhelmingly
 * `"status":"passed","failureMessages":[]`, the coverage summary another
 * ~500 KB of per-file entries, and the push carrying both was 31x over the
 * server's 100 KB body limit - so `quality_runs` never received a single row.
 * Nothing read those bytes either: no endpoint ever served them back. What is
 * left is the ~200 bytes the tab actually renders, which cannot hit a body
 * limit at all.
 *
 * Per-file coverage, if it is ever wanted, is a CI re-run rather than a parse
 * of history that was being paid for and never read.
 *
 * ## ⚠️ One row per day, and the last push wins
 *
 * `(projectId, branch, day)` is UNIQUE and {@link QualityService.record}
 * upserts onto it. A branch pushing eleven times in a day leaves one row: the
 * eleventh.
 *
 * This reverses an earlier rule that said pushes APPEND, on the grounds that a
 * re-run of a flaky suite is information rather than noise. That argument was
 * about `commitSha`, and it is still true of one; it is not a reason to keep
 * eleven rows to draw one point. The tab plots a daily timeline, so a day is
 * what a row is for, and the newest measurement of a day is the one that
 * describes it.
 *
 * What that costs: intra-day variation is not recoverable. A suite that went
 * red at noon and green at six reads as green.
 *
 * `day` is stamped SERVER-side from `DateTimeProvider`, never sent by the
 * caller: a CI runner's clock and timezone must not decide which bucket its
 * push lands in, and a client able to name its own bucket could overwrite any
 * other day at will.
 *
 * ## ⚠️ `createdAt` is the first push of the day, `updatedAt` the kept one
 *
 * An upsert leaves `createdAt` where the first write of the day put it, so it
 * is the wrong column to render as "last measured" - the staleness line reads
 * `updatedAt`, which `Repository.upsert` stamps on every conflict path.
 *
 * `projectId` cascades: wiping a project wipes its runs.
 */
export const qualityRuns = $entity({
  name: "quality_runs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    /**
     * When the run this row now describes was pushed. See the class doc: with
     * one row per day, this is the honest "last measured" stamp and
     * `createdAt` is not.
     */
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * UTC day bucket, `YYYY-MM-DD`. Server-stamped, and half of what makes a
     * row unique. Same shape as `sigil_uniques_daily.day`.
     */
    day: z.string().min(10).max(10),
    /**
     * The commit the kept run measured. Not a key: a day can hold several
     * commits and only the last one survives, so this names which one that
     * was rather than identifying the row.
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
  }),
  indexes: [
    // The upsert target. Also the index `findLatest` reads: one branch,
    // newest day first.
    { columns: ["projectId", "branch", "day"], unique: true },
    // The series behind the tab's graphs, every branch, newest day first.
    { columns: ["projectId", "day"] },
  ],
});

export type QualityRun = Infer<typeof qualityRuns.schema>;
