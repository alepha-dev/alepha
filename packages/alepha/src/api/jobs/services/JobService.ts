import { $inject, Alepha, AlephaError, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { NotFoundError } from "alepha/server";
import type { JobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { jobExecutionLogEntity } from "../entities/jobExecutionLogEntity.ts";
import { $job } from "../primitives/$job.ts";
import type { JobTriggerContext } from "../providers/JobProvider.ts";
import { JobProvider } from "../providers/JobProvider.ts";
import type { JobActivityPoint } from "../schemas/jobActivitySchema.ts";
import type { JobCronInfo } from "../schemas/jobCronInfoSchema.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";
import type { JobFailure } from "../schemas/jobFailureSchema.ts";
import type { JobQueueDepth } from "../schemas/jobQueueDepthSchema.ts";
import type { JobRegistration } from "../schemas/jobRegistrationSchema.ts";
import type { JobStats } from "../schemas/jobStatsSchema.ts";

// -----------------------------------------------------------------------------------------------------------------

export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly jobProvider = $inject(JobProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly executions = $repository(jobExecutionEntity);
  protected readonly executionLogs = $repository(jobExecutionLogEntity);

  protected computeCan(status: string) {
    return {
      retry: status === "dead" || status === "cancelled",
      cancel:
        status === "pending" ||
        status === "running" ||
        status === "scheduled" ||
        status === "retrying",
    };
  }

  /**
   * Convert an ISO date string to the raw SQL parameter format
   * expected by the current database dialect.
   *
   * - PostgreSQL: ISO string (timestamp comparison)
   * - SQLite: epoch milliseconds (integer comparison)
   */
  protected toRawDate(iso: string): string | number {
    return this.database.dialect === "sqlite" ? new Date(iso).getTime() : iso;
  }

  public async getStats(): Promise<JobStats> {
    const jobs = this.jobProvider.getRegisteredJobs();
    const twentyFourHoursAgo = this.toRawDate(
      this.dt.now().subtract(24, "hour").toISOString(),
    );

    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
          COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
          COUNT(*) FILTER (WHERE ${e.status} = 'scheduled') AS scheduled,
          COUNT(*) FILTER (WHERE ${e.status} = 'retrying') AS retrying,
          COUNT(*) FILTER (WHERE ${e.status} = 'dead') AS dead,
          COUNT(*) FILTER (WHERE ${e.status} = 'completed' AND ${e.completedAt} >= ${twentyFourHoursAgo}) AS completed_24h,
          COUNT(*) FILTER (WHERE ${e.status} IN ('dead', 'failed') AND ${e.completedAt} >= ${twentyFourHoursAgo}) AS failed_24h
        FROM ${e}
      `,
      t.object({
        running: t.string(),
        pending: t.string(),
        scheduled: t.string(),
        retrying: t.string(),
        dead: t.string(),
        completed_24h: t.string(),
        failed_24h: t.string(),
      }),
    );

    const row = rows[0];
    return {
      registered: jobs.size,
      running: Number(row.running),
      pending: Number(row.pending),
      scheduled: Number(row.scheduled),
      retrying: Number(row.retrying),
      dead: Number(row.dead),
      completed24h: Number(row.completed_24h),
      failed24h: Number(row.failed_24h),
    };
  }

  public getRegistry(): JobRegistration[] {
    const jobs = this.jobProvider.getRegisteredJobs();
    const result: JobRegistration[] = [];

    for (const [name, reg] of jobs) {
      const opts = reg.options;
      const hasCron = Boolean(opts.cron);
      const hasSchema = Boolean(opts.schema);

      let type: "cron" | "push" | "both";
      if (hasCron && hasSchema) {
        type = "both";
      } else if (hasCron) {
        type = "cron";
      } else {
        type = "push";
      }

      const registration: JobRegistration = {
        name,
        type,
        priority: (opts.priority ?? "normal") as JobRegistration["priority"],
        concurrency: opts.concurrency ?? 1,
        hasSchema,
        cron: opts.cron,
        timeout: opts.timeout ? String(opts.timeout) : undefined,
        retry: opts.retry
          ? {
              retries: opts.retry.retries,
              hasBackoff: Boolean(opts.retry.backoff),
            }
          : undefined,
        batch: opts.batch
          ? {
              size: opts.batch.size,
              window: String(opts.batch.window),
            }
          : undefined,
      };

      result.push(registration);
    }

    return result;
  }

  public async findExecutions(query: JobExecutionQuery = {}) {
    query.sort ??= "-createdAt";

    const where = this.executions.createQueryWhere();

    if (query.job) {
      where.jobName = { eq: query.job };
    }

    if (query.status) {
      where.status = { eq: query.status };
    }

    if (query.priority) {
      const priorityMap: Record<string, number> = {
        critical: 0,
        high: 1,
        normal: 2,
        low: 3,
      };
      where.priority = { eq: priorityMap[query.priority] };
    }

    if (query.from) {
      where.createdAt = { gte: query.from };
    }

    if (query.to) {
      where.createdAt = {
        ...(where.createdAt as object),
        lte: query.to,
      };
    }

    const page = await this.executions.paginate(
      query,
      { where },
      { count: true },
    );
    return {
      ...page,
      content: page.content.map((exec: JobExecutionEntity) => ({
        ...exec,
        can: this.computeCan(exec.status),
      })),
    };
  }

  public async getExecution(id: string) {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }

    const logRecord = await this.executionLogs.findById(id);

    return {
      ...execution,
      can: this.computeCan(execution.status),
      logs: logRecord?.logs,
    };
  }

  public async triggerJob(
    name: string,
    context?: JobTriggerContext,
  ): Promise<{ ok: boolean }> {
    const jobPrimitives = this.alepha.primitives($job);
    const job = jobPrimitives.find((j) => j.name === name);

    if (!job) {
      throw new NotFoundError(`Job not found: ${name}`);
    }

    this.log.info(`Triggering job '${name}'`, {
      triggeredBy: context?.triggeredByName ?? context?.triggeredBy,
    });

    await job.trigger(context);
    return { ok: true };
  }

  public async retryExecution(
    id: string,
    context?: { triggeredBy?: string; triggeredByName?: string },
  ): Promise<{ ok: boolean }> {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }

    if (execution.status !== "dead" && execution.status !== "cancelled") {
      throw new AlephaError(
        `Cannot retry execution in '${execution.status}' status`,
      );
    }

    this.log.info(`Retrying execution ${id}`, {
      jobName: execution.jobName,
      previousStatus: execution.status,
      triggeredBy: context?.triggeredByName ?? context?.triggeredBy,
    });

    const jobPrimitives = this.alepha.primitives($job);
    const job = jobPrimitives.find((j) => j.name === execution.jobName);

    if (!job) {
      throw new NotFoundError(`Job not found: ${execution.jobName}`);
    }

    if (execution.payload) {
      await job.push(execution.payload, {});
    } else {
      await job.trigger({
        triggeredBy: context?.triggeredBy,
        triggeredByName: context?.triggeredByName,
      });
    }

    return { ok: true };
  }

  public async cancelExecution(
    id: string,
    context?: { cancelledBy?: string; cancelledByName?: string },
  ): Promise<{ ok: boolean }> {
    this.log.info(`Cancelling execution ${id}`, {
      cancelledBy: context?.cancelledByName ?? context?.cancelledBy,
    });

    await this.jobProvider.cancel(id, {
      cancelledBy: context?.cancelledBy,
      cancelledByName: context?.cancelledByName,
    });
    return { ok: true };
  }

  public async getCronJobs(): Promise<JobCronInfo[]> {
    const jobs = this.jobProvider.getRegisteredJobs();
    const cronJobNames: string[] = [];

    for (const [name, reg] of jobs) {
      if (reg.options.cron) cronJobNames.push(name);
    }

    const lastByJob = await this.getLastExecutionPerJob(cronJobNames);

    const result: JobCronInfo[] = [];
    for (const name of cronJobNames) {
      const reg = jobs.get(name)!;
      const opts = reg.options;
      const last = lastByJob.get(name);

      result.push({
        name,
        cron: opts.cron!,
        lock: opts.lock !== false,
        priority: (opts.priority ?? "normal") as JobCronInfo["priority"],
        concurrency: opts.concurrency ?? 1,
        hasSchema: Boolean(opts.schema),
        lastExecution: last
          ? {
              id: last.id,
              status: last.status,
              startedAt: last.started_at ?? undefined,
              completedAt: last.completed_at ?? undefined,
              error: last.error ?? undefined,
            }
          : undefined,
      });
    }

    return result;
  }

  public async getQueueDepth(): Promise<JobQueueDepth[]> {
    const jobs = this.jobProvider.getRegisteredJobs();

    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          ${e.jobName} AS job_name,
          COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
          COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
          COUNT(*) FILTER (WHERE ${e.status} = 'scheduled') AS scheduled,
          COUNT(*) FILTER (WHERE ${e.status} = 'retrying') AS retrying,
          COUNT(*) FILTER (WHERE ${e.status} = 'dead') AS dead
        FROM ${e}
        WHERE ${e.status} IN ('pending', 'running', 'scheduled', 'retrying', 'dead')
        GROUP BY ${e.jobName}
      `,
      t.object({
        job_name: t.string(),
        pending: t.string(),
        running: t.string(),
        scheduled: t.string(),
        retrying: t.string(),
        dead: t.string(),
      }),
    );

    const counts = new Map(rows.map((r) => [r.job_name, r]));

    const result: JobQueueDepth[] = [];
    for (const [name, reg] of jobs) {
      const row = counts.get(name);
      result.push({
        jobName: name,
        pending: Number(row?.pending ?? 0),
        running: Number(row?.running ?? 0),
        scheduled: Number(row?.scheduled ?? 0),
        retrying: Number(row?.retrying ?? 0),
        dead: Number(row?.dead ?? 0),
        concurrency: reg.options.concurrency ?? 1,
      });
    }

    return result;
  }

  public async getActivity(days = 14): Promise<JobActivityPoint[]> {
    if (this.database.dialect === "sqlite") {
      return this.getActivitySqlite(days);
    }

    const rows = await this.executions.query(
      (e) => sql`
        WITH date_series AS (
          SELECT generate_series(
            CURRENT_DATE - ${days - 1}::int,
            CURRENT_DATE,
            '1 day'::interval
          )::date AS date
        )
        SELECT
          ds.date::text AS date,
          COALESCE(COUNT(*) FILTER (WHERE ${e.status} = 'completed'), 0) AS completed,
          COALESCE(COUNT(*) FILTER (WHERE ${e.status} IN ('dead', 'failed')), 0) AS failed
        FROM date_series ds
        LEFT JOIN ${e} ON DATE(${e.completedAt}) = ds.date
          AND ${e.status} IN ('completed', 'dead', 'failed')
        GROUP BY ds.date
        ORDER BY ds.date ASC
      `,
      t.object({
        date: t.string(),
        completed: t.string(),
        failed: t.string(),
      }),
    );

    return rows.map((row) => ({
      date: row.date,
      completed: Number(row.completed),
      failed: Number(row.failed),
    }));
  }

  protected async getActivitySqlite(days = 14): Promise<JobActivityPoint[]> {
    const now = this.dt.now();
    const startDate = now.subtract(days - 1, "day");

    const where = this.executions.createQueryWhere();
    where.status = { inArray: ["completed", "dead", "failed"] };
    where.completedAt = { gte: startDate.startOf("day").toISOString() };

    const executions = await this.executions.findMany({ where });

    // Build date → counts map
    const byDate = new Map<string, { completed: number; failed: number }>();
    for (let i = 0; i < days; i++) {
      const date = startDate.add(i, "day").format("YYYY-MM-DD");
      byDate.set(date, { completed: 0, failed: 0 });
    }

    for (const exec of executions) {
      if (!exec.completedAt) continue;
      const date = this.dt.of(exec.completedAt).format("YYYY-MM-DD");
      const entry = byDate.get(date);
      if (!entry) continue;
      if (exec.status === "completed") entry.completed++;
      else entry.failed++;
    }

    return [...byDate.entries()].map(([date, counts]) => ({
      date,
      ...counts,
    }));
  }

  public async getTopFailures(): Promise<JobFailure[]> {
    const sevenDaysAgoIso = this.dt.now().subtract(7, "day").toISOString();

    if (this.database.dialect === "sqlite") {
      return this.getTopFailuresSqlite(sevenDaysAgoIso);
    }

    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          ${e.jobName} AS job_name,
          COUNT(*) AS failures,
          (ARRAY_AGG(${e.error} ORDER BY ${e.completedAt} DESC))[1] AS last_error
        FROM ${e}
        WHERE ${e.status} IN ('dead', 'failed')
          AND ${e.completedAt} >= ${sevenDaysAgoIso}
        GROUP BY ${e.jobName}
        ORDER BY failures DESC
      `,
      t.object({
        job_name: t.string(),
        failures: t.string(),
        last_error: t.optional(t.nullable(t.string())),
      }),
    );

    return rows.map((row) => ({
      jobName: row.job_name,
      failures: Number(row.failures),
      lastError: row.last_error ?? undefined,
    }));
  }

  protected async getTopFailuresSqlite(
    sevenDaysAgoIso: string,
  ): Promise<JobFailure[]> {
    const where = this.executions.createQueryWhere();
    where.status = { inArray: ["dead", "failed"] };
    where.completedAt = { gte: sevenDaysAgoIso };

    const failures = await this.executions.findMany({
      where,
      orderBy: { column: "completedAt", direction: "desc" },
    });

    const byJob = new Map<string, { failures: number; lastError?: string }>();
    for (const exec of failures) {
      const entry = byJob.get(exec.jobName) ?? { failures: 0 };
      entry.failures++;
      if (!entry.lastError) entry.lastError = exec.error ?? undefined;
      byJob.set(exec.jobName, entry);
    }

    return [...byJob.entries()]
      .map(([jobName, data]) => ({
        jobName,
        failures: data.failures,
        lastError: data.lastError,
      }))
      .sort((a, b) => b.failures - a.failures);
  }

  /**
   * Fetch the most recent execution per job name.
   *
   * - PostgreSQL: uses `DISTINCT ON` for a single-pass query
   * - SQLite: uses ORM queries (one per job name) since `DISTINCT ON` is not supported
   */
  protected async getLastExecutionPerJob(jobNames: string[]): Promise<
    Map<
      string,
      {
        id: string;
        job_name: string;
        status: string;
        started_at?: string | null;
        completed_at?: string | null;
        error?: string | null;
      }
    >
  > {
    if (jobNames.length === 0) {
      return new Map();
    }

    if (this.database.dialect === "sqlite") {
      const result = new Map<string, any>();
      for (const name of jobNames) {
        const rows = await this.executions.findMany({
          where: { jobName: { eq: name } },
          orderBy: { column: "createdAt", direction: "desc" },
          limit: 1,
        });
        if (rows[0]) {
          result.set(name, {
            id: rows[0].id,
            job_name: rows[0].jobName,
            status: rows[0].status,
            started_at: rows[0].startedAt,
            completed_at: rows[0].completedAt,
            error: rows[0].error,
          });
        }
      }
      return result;
    }

    const schema = t.object({
      id: t.string(),
      job_name: t.string(),
      status: t.string(),
      started_at: t.optional(t.nullable(t.string())),
      completed_at: t.optional(t.nullable(t.string())),
      error: t.optional(t.nullable(t.string())),
    });

    const rows = await this.executions.query(
      (e) => sql`
        SELECT DISTINCT ON (${e.jobName})
          ${e.id}, ${e.jobName} AS job_name, ${e.status},
          ${e.startedAt} AS started_at, ${e.completedAt} AS completed_at, ${e.error}
        FROM ${e}
        WHERE ${e.jobName} IN (${sql.join(
          jobNames.map((n) => sql`${n}`),
          sql`, `,
        )})
        ORDER BY ${e.jobName}, ${e.createdAt} DESC
      `,
      schema,
    );

    return new Map(rows.map((r) => [r.job_name, r]));
  }
}
