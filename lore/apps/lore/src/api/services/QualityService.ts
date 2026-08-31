import { $inject } from "alepha";
import { $storage, FileService, files } from "alepha/api/files";
import { $repository } from "alepha/orm";

import { type QualityRun, qualityRuns } from "../entities/qualityRuns.ts";

/**
 * Everything that writes or removes a quality run.
 *
 * It exists as a service rather than as three handler bodies for one reason:
 * `quality_runs.fileId` carries no foreign key, so the database will not take
 * the raw report with the row. A `deleteMany` issued anywhere else leaves
 * bytes in the bucket that nothing can reach and nothing will ever collect -
 * a bug `folio_blobs` has already shipped once and documents. {@link delete}
 * is the only legal way to remove a run, and {@link prune} goes through it.
 *
 * Deliberately NOT sharing a base with `FolioBlobService`, whose write rules
 * are the opposite of these: auto-suffix against siblings vs no naming at all,
 * renameable vs immutable, one blob per folio vs one report per run.
 */
export class QualityService {
  /**
   * The storage the raw reports live in.
   *
   * ⚠️ No `ttl`, and that is a decision rather than an omission. A TTL would
   * hand these files to `api:files:purgeFiles`, which deletes rows and blobs
   * hourly once past `expirationDate` - destroying exactly the history that
   * makes "per-file coverage later, without a CI re-run" possible. Retention
   * is the 500-row cap in `ProjectLimits` instead, swept by `QualityJobs`.
   */
  public static readonly BUCKET = "quality-runs";

  protected readonly runs = $repository(qualityRuns);
  protected readonly frameworkFiles = $repository(files);
  protected readonly fileService = $inject(FileService);

  /**
   * Sized for JSON rather than for images. A `json-summary` for a repository
   * this size is a few hundred kilobytes with one entry per file, and the
   * vitest report adds one object per spec; 8 MB is far above both and still
   * refuses anything that is not a report.
   */
  public readonly reports = $storage({
    name: QualityService.BUCKET,
    description: "Raw coverage and test reports, one file per quality run",
    mimeTypes: ["application/json"],
    maxSize: 8,
  });

  /**
   * Write a run, with its raw reports beside it.
   *
   * The bytes go first: the row needs the resulting file id, and an upload
   * that succeeds with no row behind it is collected by the storage's own
   * failure path, where a row pointing at a file that was never written is
   * not collected by anything.
   */
  public async record(input: QualityRunInput): Promise<QualityRun> {
    const fileId = input.reports ? await this.storeReports(input) : undefined;

    return this.runs.create({
      projectId: input.projectId,
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
      fileId,
    });
  }

  /**
   * The newest run on a branch, or across the project when no branch is named.
   *
   * "Newest row", never "the row for this sha": pushes append, so a commit can
   * have several and the last one to arrive is the one that counts.
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
      orderBy: [{ column: "createdAt", direction: "desc" }],
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
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit,
    });
  }

  /**
   * Remove a run and the bytes behind it. The only legal way to do either.
   */
  public async delete(id: string): Promise<void> {
    const run = await this.runs.findOne({ where: { id: { eq: id } } });
    if (!run) return;

    await this.runs.deleteById(id);
    await this.deleteReports([run]);
  }

  /**
   * Keep the newest `cap` runs of a project and remove the rest, bytes
   * included. Returns how many went, which is what makes the sweep
   * assertable.
   */
  public async prune(projectId: number, cap: number): Promise<number> {
    const doomed = await this.runs.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      offset: cap,
      // A cap is a steady-state target, not a backlog swallower: a project
      // that has never been swept catches up over several runs of the job
      // rather than in one transaction on a Worker with a wall clock.
      limit: QualityService.MAX_PRUNE_PER_SWEEP,
    });
    if (doomed.length === 0) return 0;

    await this.runs.deleteMany({ id: { inArray: doomed.map((it) => it.id) } });
    await this.deleteReports(doomed);
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
   * Whether a run's raw report is still there.
   *
   * There is no foreign key, so the file row can be gone while the run stays.
   * The read path asks this instead of assuming, and renders the totals
   * either way.
   */
  public async hasReport(run: QualityRun): Promise<boolean> {
    if (!run.fileId) return false;
    const file = await this.frameworkFiles.findOne({
      where: { id: { eq: run.fileId } },
    });
    return file !== undefined;
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
   * Both reports in one file, so one run is one blob rather than two that can
   * half-survive each other.
   */
  protected async storeReports(input: QualityRunInput): Promise<string> {
    const body = JSON.stringify(input.reports);
    const file = new File([body], `${input.commitSha}.json`, {
      type: "application/json",
    });

    const stored = await this.reports.upload(file);
    return stored.id;
  }

  /**
   * Delete the bytes of runs whose rows have already gone.
   *
   * Ids with no file row are tolerated rather than refused: that orphan state
   * is exactly what this table's missing foreign key allows, so hitting it is
   * normal rather than exceptional.
   */
  protected async deleteReports(runs: QualityRun[]): Promise<void> {
    const ids = runs
      .map((it) => it.fileId)
      .filter((it): it is string => it !== undefined);
    if (ids.length === 0) return;

    await this.fileService.deleteFiles(ids);
  }
}

/**
 * What a caller hands {@link QualityService.record}: the totals a CI job
 * extracted, plus the reports it extracted them from.
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
  reports?: Record<string, any>;
}
