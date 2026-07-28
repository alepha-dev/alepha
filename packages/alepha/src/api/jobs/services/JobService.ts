import { $inject, Alepha, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";
import { NotFoundError } from "alepha/server";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { $job } from "../primitives/$job.ts";
import type { JobTriggerContext } from "../providers/JobProvider.ts";
import { JobProvider, PRIORITY_REVERSE } from "../providers/JobProvider.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";
import type { JobExecutionResource } from "../schemas/jobExecutionResourceSchema.ts";
import type { JobRegistration } from "../schemas/jobRegistrationSchema.ts";

/**
 * Admin surface for the job system.
 *
 * Six methods: list jobs, list executions, get execution,
 * trigger, retry, cancel. Everything else lives in events — any
 * analytics/observability is an external concern that subscribes
 * to `job:begin` / `job:success` / `job:error`.
 */
export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly jobProvider = $inject(JobProvider);
  protected readonly executions = $repository(jobExecutionEntity);

  protected computeCan(status: string) {
    return {
      retry: status === "error" || status === "cancelled",
      cancel:
        status === "pending" || status === "running" || status === "scheduled",
    };
  }

  /**
   * Convert the int-priority storage column into the public enum string.
   * The cast through `unknown` skips TypeScript's structural check between
   * the entity-level row (`priority: number`) and the resource schema
   * (`priority: enum`); the runtime values are correct.
   */
  protected toResource<T extends { priority: number; status: string }>(
    row: T,
  ): JobExecutionResource {
    return {
      ...row,
      priority: PRIORITY_REVERSE[row.priority] ?? "normal",
      can: this.computeCan(row.status),
    } as unknown as JobExecutionResource;
  }

  /**
   * List every registered job with recent ok/error counts and lastRun.
   * One aggregate query covers all jobs.
   */
  public async listJobs(): Promise<JobRegistration[]> {
    const registry = this.jobProvider.getRegisteredJobs();

    const aggRows = await this.executions.query(
      (e) => sql`
        SELECT
          ${e.jobName} AS job_name,
          ${e.status} AS status,
          COUNT(*) AS count,
          MAX(${e.completedAt}) AS last_run
        FROM ${e}
        WHERE ${e.status} IN ('ok', 'error')
        GROUP BY ${e.jobName}, ${e.status}
      `,
      z.object({
        job_name: z.string(),
        status: z.string(),
        // Postgres returns COUNT(*) as a bigint, which the driver hands back as
        // a string; SQLite (and therefore D1) returns a plain number. Pinning
        // this to `string` made the whole listing 500 on every SQLite
        // deployment. `Number(row.count)` below already accepts either.
        count: z.union([z.string(), z.number()]),
        last_run: z.union([z.string(), z.number()]).nullable().optional(),
      }),
    );

    const toIso = (
      v: string | number | null | undefined,
    ): string | undefined => {
      if (v === null || v === undefined) return undefined;
      if (typeof v === "number") return new Date(v).toISOString();
      return v;
    };

    const byJob = new Map<
      string,
      { ok: number; error: number; lastRun?: string }
    >();
    for (const row of aggRows) {
      const entry = byJob.get(row.job_name) ?? { ok: 0, error: 0 };
      if (row.status === "ok") entry.ok = Number(row.count);
      if (row.status === "error") entry.error = Number(row.count);
      const iso = toIso(row.last_run);
      if (iso && (!entry.lastRun || iso > entry.lastRun)) {
        entry.lastRun = iso;
      }
      byJob.set(row.job_name, entry);
    }

    const result: JobRegistration[] = [];
    for (const [name, reg] of registry) {
      const opts = reg.options;
      const counts = byJob.get(name) ?? { ok: 0, error: 0 };
      result.push({
        name,
        description: opts.description,
        type: this.jobProvider.effectiveMode(name),
        cron: opts.cron,
        priority: (opts.priority ?? "normal") as JobRegistration["priority"],
        timeout: opts.timeout ? String(opts.timeout) : undefined,
        retry: opts.retry
          ? {
              retries: opts.retry.retries,
            }
          : undefined,
        recent: counts,
      });
    }
    return result;
  }

  /**
   * Recent executions for a single job, ORDER BY startedAt DESC.
   */
  public async getExecutions(jobName: string, query: JobExecutionQuery = {}) {
    const registry = this.jobProvider.getRegisteredJobs();
    if (!registry.has(jobName)) {
      throw new NotFoundError(`Job not found: ${jobName}`);
    }
    const where = this.executions.createQueryWhere();
    where.jobName = { eq: jobName };
    if (query.status) {
      where.status = { eq: query.status };
    }
    const rows = await this.executions.findMany({
      where,
      orderBy: { column: "startedAt", direction: "desc" },
      limit: query.limit ?? 20,
    });
    return rows.map((row) => this.toResource(row));
  }

  /**
   * Full execution detail (includes captured logs).
   */
  public async getExecution(id: string) {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }
    return this.toResource(execution);
  }

  /**
   * Manual trigger (cron jobs) or push-with-payload (queue jobs).
   */
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

  /**
   * Retry a dead or cancelled execution by re-pushing with the original payload.
   */
  public async retryExecution(
    id: string,
    context?: { triggeredBy?: string; triggeredByName?: string },
  ): Promise<{ ok: boolean }> {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }
    if (execution.status !== "error" && execution.status !== "cancelled") {
      throw new AlephaError(
        `Cannot retry execution in '${execution.status}' status`,
      );
    }

    const jobPrimitives = this.alepha.primitives($job);
    const job = jobPrimitives.find((j) => j.name === execution.jobName);
    if (!job) {
      throw new NotFoundError(`Job not found: ${execution.jobName}`);
    }

    this.log.info(`Retrying execution ${id}`, {
      jobName: execution.jobName,
      previousStatus: execution.status,
      triggeredBy: context?.triggeredByName ?? context?.triggeredBy,
    });

    if (execution.payload) {
      // Carry the original execution's context across. The push branch used
      // to drop `organizationId` and `key` entirely, so a retried tenant
      // notification lost its org scoping — and the retry was attributed to
      // nobody.
      await job.push(execution.payload as any, {
        organizationId: execution.organizationId ?? undefined,
        triggeredBy: context?.triggeredBy,
        triggeredByName: context?.triggeredByName,
      });
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
}
