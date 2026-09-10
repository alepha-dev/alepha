import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

import type { CiRun } from "../schemas/ciRunSchema.ts";

/**
 * The fields Loom reads from GitHub's workflow run object.
 */
export interface GhRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
  head_branch: string;
  event: string;
  run_started_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * The fields Loom reads from GitHub's job object.
 */
export interface GhJob {
  status: string;
  conclusion: string | null;
  steps?: Array<{ status: string }>;
}

/**
 * GitHub Actions, read through the `gh` CLI so Loom never holds a token of its
 * own: whoever ran `gh auth login` is who Loom asks as.
 *
 * One `actions/runs` call per repository per refresh, cached for
 * {@link runsTtl}, answers every branch at once. Jobs are fetched only for a
 * run that is still going (for its progress) or failed (for how many jobs).
 */
export class CiService {
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  protected readonly runsTtl = 15_000;
  protected readonly liveJobsTtl = 8_000;
  protected readonly doneJobsTtl = 600_000;

  protected readonly runsCache = new Map<
    string,
    { at: number; runs: GhRun[] }
  >();
  protected readonly jobsCache = new Map<
    number,
    { at: number; jobs: GhJob[] }
  >();
  protected installed?: boolean;

  public async available(): Promise<boolean> {
    this.installed ??= await this.shell.isInstalled("gh");
    return this.installed;
  }

  /**
   * The latest run of each branch, keyed by branch. A branch with no run is
   * absent. `undefined` when GitHub could not be asked at all.
   */
  public async latest(
    github: string,
    branches: string[],
  ): Promise<Map<string, CiRun> | undefined> {
    const runs = await this.runs(github);
    if (!runs) {
      return undefined;
    }
    const result = new Map<string, CiRun>();
    await Promise.all(
      branches.map(async (branch) => {
        const run = this.pick(runs, branch);
        if (run) {
          result.set(branch, await this.toCiRun(github, run));
        }
      }),
    );
    return result;
  }

  /**
   * The branch's newest run, preferring one its own push started: on `main`
   * the newest run is often a `workflow_run` follow-up (a deploy) that says
   * nothing about whether the branch is green.
   */
  public pick(runs: GhRun[], branch: string): GhRun | undefined {
    const own = runs.filter((run) => run.head_branch === branch);
    return (
      own.find((run) => run.event === "push" || run.event === "pull_request") ??
      own[0]
    );
  }

  /**
   * 0 to 100: finished jobs, plus the finished share of each running job's
   * steps, over all jobs. A queued run with no jobs yet is at 0.
   */
  public progress(jobs: GhJob[]): number {
    if (jobs.length === 0) {
      return 0;
    }
    let done = 0;
    for (const job of jobs) {
      if (job.status === "completed") {
        done += 1;
      } else if (job.status === "in_progress" && job.steps?.length) {
        const finished = job.steps.filter(
          (step) => step.status === "completed",
        ).length;
        done += finished / job.steps.length;
      }
    }
    return Math.round((done / jobs.length) * 100);
  }

  protected async toCiRun(github: string, run: GhRun): Promise<CiRun> {
    const ci: CiRun = {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? undefined,
      url: run.html_url,
      headSha: run.head_sha,
      startedAt: run.run_started_at ?? run.created_at,
      updatedAt: run.updated_at,
    };
    const live = run.status !== "completed";
    if (!live && run.conclusion !== "failure") {
      return ci;
    }
    const jobs = await this.jobs(github, run.id, live);
    if (jobs) {
      ci.jobs = {
        total: jobs.length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.conclusion === "failure").length,
      };
      if (live) {
        ci.progress = this.progress(jobs);
      }
    }
    return ci;
  }

  protected async runs(github: string): Promise<GhRun[] | undefined> {
    const now = this.dateTime.nowMillis();
    const cached = this.runsCache.get(github);
    if (cached && now - cached.at < this.runsTtl) {
      return cached.runs;
    }
    const body = await this.api<{ workflow_runs: GhRun[] }>(
      `repos/${github}/actions/runs?per_page=50`,
    );
    if (!body) {
      return cached?.runs;
    }
    this.runsCache.set(github, { at: now, runs: body.workflow_runs });
    return body.workflow_runs;
  }

  protected async jobs(
    github: string,
    runId: number,
    live: boolean,
  ): Promise<GhJob[] | undefined> {
    const now = this.dateTime.nowMillis();
    const cached = this.jobsCache.get(runId);
    const ttl = live ? this.liveJobsTtl : this.doneJobsTtl;
    if (cached && now - cached.at < ttl) {
      return cached.jobs;
    }
    const body = await this.api<{ jobs: GhJob[] }>(
      `repos/${github}/actions/runs/${runId}/jobs?per_page=100`,
    );
    if (!body) {
      return cached?.jobs;
    }
    this.jobsCache.set(runId, { at: now, jobs: body.jobs });
    return body.jobs;
  }

  protected async api<T>(path: string): Promise<T | undefined> {
    if (!(await this.available())) {
      return undefined;
    }
    try {
      const result = await this.shell.capture(["gh", "api", path], {
        timeout: 15_000,
      });
      if (result.exitCode !== 0) {
        this.log.warn(`gh api ${path} failed: ${result.stderr.trim()}`);
        return undefined;
      }
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      this.log.warn(`gh api ${path} failed`, error);
      return undefined;
    }
  }
}
