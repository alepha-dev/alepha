import { $inject, Alepha, AlephaError, type Page, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";
import { ConflictError, NotFoundError } from "alepha/server";

import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { $job } from "../primitives/$job.ts";
import type { JobTriggerContext } from "../providers/JobProvider.ts";
import { JobProvider } from "../providers/JobProvider.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";
import type { JobExecutionResource } from "../schemas/jobExecutionResourceSchema.ts";
import type { JobExecutionRow } from "../schemas/jobExecutionRowSchema.ts";
import type { JobRegistration } from "../schemas/jobRegistrationSchema.ts";

/**
 * Admin surface for the job system.
 *
 * List jobs, page a job's executions, read one, trigger, retry, cancel and
 * delete. Everything else lives in events: any analytics or observability is
 * an external concern that subscribes to `job:begin` / `job:success` /
 * `job:error`.
 */
export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly jobProvider = $inject(JobProvider);
  protected readonly executions = $repository(jobExecutionEntity);

  /**
   * The statuses a run can no longer leave. Only these rows may be deleted:
   * the others are work the outbox is still responsible for.
   */
  protected readonly terminalStatuses = ["ok", "error", "cancelled"] as const;

  /**
   * What a list row is read with: everything but `payload` and `logs`, which
   * can be large and which only the detail view shows.
   */
  protected readonly rowColumns = [
    "id",
    "createdAt",
    "updatedAt",
    "jobName",
    "key",
    "organizationId",
    "status",
    "attempt",
    "maxAttempts",
    "redispatchCount",
    "scheduledAt",
    "startedAt",
    "completedAt",
    "error",
    "triggeredBy",
    "triggeredByName",
    "cancelledBy",
    "cancelledByName",
  ] as const;

  protected computeCan(status: string) {
    return {
      retry: status === "error" || status === "cancelled",
      cancel:
        status === "pending" || status === "running" || status === "scheduled",
      delete: this.isTerminal(status),
    };
  }

  protected isTerminal(status: string): boolean {
    return (this.terminalStatuses as readonly string[]).includes(status);
  }

  /**
   * A row with the admin actions its status allows.
   */
  protected toResource<T extends { status: string }>(
    row: T,
  ): JobExecutionResource {
    return {
      ...row,
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
        timeout: opts.timeout
          ? this.dt.duration(opts.timeout).toISOString()
          : undefined,
        retry: opts.retry
          ? {
              retries: opts.retry.retries,
            }
          : undefined,
        retention: this.jobProvider.describeRetention(name),
        recent: counts,
      });
    }
    return result;
  }

  /**
   * One page of a job's executions, newest first unless `sort` says
   * otherwise, with a total. Rows carry neither `payload` nor `logs`.
   *
   * The trigger filter maps onto what every write stores in `triggeredBy`: a
   * cron tick writes `"system"`, an admin trigger or retry writes the user's
   * id, and a push from code, `pushMany` or devtools writes nothing.
   */
  public async getExecutions(
    jobName: string,
    query: JobExecutionQuery = {},
  ): Promise<Page<JobExecutionRow>> {
    const registry = this.jobProvider.getRegisteredJobs();
    if (!registry.has(jobName)) {
      throw new NotFoundError(`Job not found: ${jobName}`);
    }

    // Never an `undefined` inside a filter: every key is set only when used.
    const where = this.executions.createQueryWhere();
    where.jobName = { eq: jobName };
    if (query.status?.length) {
      where.status = { inArray: query.status };
    }
    if (query.trigger === "scheduled") {
      where.triggeredBy = { eq: "system" };
    } else if (query.trigger === "manual") {
      where.triggeredBy = { isNotNull: true, ne: "system" };
    } else if (query.trigger === "code") {
      where.triggeredBy = { isNull: true };
    }
    if (query.from && query.to) {
      where.startedAt = { gte: query.from, lte: query.to };
    } else if (query.from) {
      where.startedAt = { gte: query.from };
    } else if (query.to) {
      where.startedAt = { lte: query.to };
    }
    if (query.key) {
      where.key = { contains: query.key };
    }

    const page = await this.executions.paginate(
      { page: query.page, size: query.size },
      {
        where,
        orderBy: this.executionOrder(query.sort),
        columns: [...this.rowColumns],
      },
      { count: true },
    );
    return {
      ...page,
      content: page.content.map(
        (row) => this.toResource(row) as unknown as JobExecutionRow,
      ),
    };
  }

  /**
   * The ORDER BY of an executions page: the requested column, then
   * `createdAt` newest first, which is never null and so orders the same on
   * every database.
   */
  protected executionOrder(sort: JobExecutionQuery["sort"] = "-createdAt") {
    const desc = sort.startsWith("-");
    const column = (desc ? sort.slice(1) : sort) as
      | "createdAt"
      | "startedAt"
      | "completedAt"
      | "status"
      | "attempt";
    const primary = {
      column,
      direction: desc ? ("desc" as const) : ("asc" as const),
    };
    if (sort === "-createdAt") return [primary];
    return [
      primary,
      { column: "createdAt" as const, direction: "desc" as const },
    ];
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

  /**
   * Delete one terminal execution. A pending, scheduled or running row is
   * refused: it is work the outbox still owns, and deleting it would lose it
   * silently. Cancel it first.
   */
  public async deleteExecution(
    id: string,
    context?: { deletedBy?: string; deletedByName?: string },
  ): Promise<{ ok: boolean }> {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }
    const deleted = this.isTerminal(execution.status)
      ? await this.executions.deleteMany({
          id: { eq: id },
          status: { inArray: [...this.terminalStatuses] },
        })
      : [];
    if (deleted.length === 0) {
      // Not terminal, or it left a terminal status between the read and the
      // delete (a retry never does; nothing else writes a terminal row back).
      throw new ConflictError(
        `Cannot delete execution in '${execution.status}' status: it has not finished. Cancel it first.`,
      );
    }
    this.log.info(`Deleted execution ${id}`, {
      jobName: execution.jobName,
      status: execution.status,
      deletedBy: context?.deletedByName ?? context?.deletedBy,
    });
    return { ok: true };
  }

  /**
   * Delete the terminal executions among `ids` and skip the rest, reporting
   * both counts. An id that does not exist counts as skipped.
   */
  public async deleteExecutions(
    ids: string[],
    context?: { deletedBy?: string; deletedByName?: string },
  ): Promise<{ deleted: number; skipped: number }> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { deleted: 0, skipped: 0 };
    const deleted = await this.executions.deleteMany({
      id: { inArray: unique },
      status: { inArray: [...this.terminalStatuses] },
    });
    this.log.info(`Deleted ${deleted.length} execution(s)`, {
      requested: unique.length,
      skipped: unique.length - deleted.length,
      deletedBy: context?.deletedByName ?? context?.deletedBy,
    });
    return { deleted: deleted.length, skipped: unique.length - deleted.length };
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
