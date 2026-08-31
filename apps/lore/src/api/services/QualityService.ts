import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type QualityRun, qualityRuns } from "../entities/qualityRuns.ts";

/**
 * Everything that writes or removes a quality run.
 *
 * It used to exist because `quality_runs.fileId` carried no foreign key, so a
 * `deleteMany` issued anywhere else stranded bytes in a bucket forever. That
 * hazard is gone with the bucket: a run is eleven columns and the database
 * takes all of them. What is left here is the day-bucketing and the ordering,
 * which are the two things every caller would otherwise have to get right on
 * its own.
 */
export class QualityService {
  protected readonly runs = $repository(qualityRuns);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Record a run, replacing the one already stored for its branch and day.
   *
   * The upsert target is the entity's unique index, named column for column:
   * an `ON CONFLICT` target that does not match a real index is a runtime
   * error rather than a wider match. Everything else is overwritten from the
   * incoming row, which is what "the last push of the day wins" means, and
   * `Repository.upsert` stamps `updatedAt` on the conflict path so the kept
   * run carries the time it was actually pushed.
   */
  public async record(input: QualityRunInput): Promise<QualityRun> {
    return this.runs.upsert(
      {
        projectId: input.projectId,
        day: this.today(),
        commitSha: input.commitSha,
        branch: input.branch,
        coverageLines: input.coverage.lines,
        coverageStatements: input.coverage.statements,
        coverageFunctions: input.coverage.functions,
        coverageBranches: input.coverage.branches,
        testsTotal: input.tests.total,
        testsPassed: input.tests.passed,
        testsFailed: input.tests.failed,
        testsSkipped: input.tests.skipped,
        durationMs: input.durationMs,
      },
      { target: ["projectId", "branch", "day"] },
    );
  }

  /**
   * The newest run on a branch, or across the project when no branch is named.
   *
   * Ordered by `day`, which is a `YYYY-MM-DD` string and therefore sorts
   * lexicographically the way it sorts chronologically - the same reason
   * `sigil_uniques_daily` can range over one.
   */
  public async findLatest(
    projectId: number,
    branch?: string,
  ): Promise<QualityRun | undefined> {
    // `findOne` takes no `orderBy`, and "the latest" is an ordering question:
    // a limited `findMany` is the shape that can express it.
    const [latest] = await this.runs.findMany({
      where: branch
        ? { projectId: { eq: projectId }, branch: { eq: branch } }
        : { projectId: { eq: projectId } },
      orderBy: [{ column: "day", direction: "desc" }],
      limit: 1,
    });
    return latest;
  }

  /**
   * The series behind the tab's graphs, newest first.
   */
  public async findSeries(
    projectId: number,
    limit: number,
  ): Promise<QualityRun[]> {
    return this.runs.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "day", direction: "desc" }],
      limit,
    });
  }

  /**
   * Remove a run.
   */
  public async delete(id: string): Promise<void> {
    await this.runs.deleteById(id);
  }

  /**
   * Keep the newest `cap` days of a project and remove the rest. Returns how
   * many went, which is what makes the sweep assertable.
   *
   * With one row per branch per day this is close to decorative on a project
   * that only pushes from `main` - 500 rows is over a year - and stays useful
   * for one pushing from many branches.
   */
  public async prune(projectId: number, cap: number): Promise<number> {
    const doomed = await this.runs.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "day", direction: "desc" }],
      offset: cap,
      // A cap is a steady-state target, not a backlog swallower: a project
      // that has never been swept catches up over several runs of the job
      // rather than in one transaction on a Worker with a wall clock.
      limit: QualityService.MAX_PRUNE_PER_SWEEP,
    });
    if (doomed.length === 0) return 0;

    await this.runs.deleteMany({ id: { inArray: doomed.map((it) => it.id) } });
    return doomed.length;
  }

  /**
   * Project ids that have at least one run, so the sweep visits only those.
   */
  public async projectsWithRuns(): Promise<number[]> {
    const rows = await this.runs.findMany({
      columns: ["projectId"],
      distinct: ["projectId"],
    });
    return rows.map((it) => it.projectId);
  }

  /**
   * How many sweeps' worth of backlog one pass will chew through.
   *
   * Same reasoning as `SigilJobs.MAX_DAYS_PER_SWEEP`: the sweep is idempotent,
   * so the next run picks up where this one stopped, and nothing is lost by
   * taking a few hours to reach the steady state.
   */
  protected static readonly MAX_PRUNE_PER_SWEEP = 200;

  /**
   * Today's UTC day, `YYYY-MM-DD`.
   *
   * Sliced off an ISO string rather than formatted, the same way
   * `SigilIngestService.dayBucket` does it: `nowISOString()` is UTC by
   * construction, so the first ten characters are the bucket and no timezone
   * can get between the two.
   */
  protected today(): string {
    return this.dateTime.nowISOString().slice(0, 10);
  }
}

/**
 * What a caller hands {@link QualityService.record}: the totals a CI job
 * extracted.
 */
export interface QualityRunInput {
  projectId: number;
  commitSha: string;
  branch: string;
  coverage: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
}
