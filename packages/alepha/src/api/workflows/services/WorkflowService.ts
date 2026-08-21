import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import type { WorkflowExecutionEntity } from "../entities/workflowExecutions.ts";
import { workflowExecutions } from "../entities/workflowExecutions.ts";
import { workflowStepExecutions } from "../entities/workflowStepExecutions.ts";
import { WorkflowProvider } from "../providers/WorkflowProvider.ts";
import type { WorkflowActivityPoint } from "../schemas/workflowActivitySchema.ts";
import type { WorkflowExecutionQuery } from "../schemas/workflowExecutionQuerySchema.ts";
import type { WorkflowExecutionCan } from "../schemas/workflowExecutionResourceSchema.ts";
import type { WorkflowRegistration } from "../schemas/workflowRegistrationSchema.ts";
import type { WorkflowStats } from "../schemas/workflowStatsSchema.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Query/action layer behind the admin workflow endpoints.
 */
export class WorkflowService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly workflowProvider = $inject(WorkflowProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly executions = $repository(workflowExecutions);
  protected readonly stepExecutions = $repository(workflowStepExecutions);

  /**
   * Compute available actions for a workflow execution based on its status.
   */
  protected computeCan(status: string): WorkflowExecutionCan {
    return {
      retry: status === "failed" || status === "timed_out",
      cancel: status === "pending" || status === "running",
      compensate: status === "failed" || status === "timed_out",
      restart:
        status === "failed" ||
        status === "compensated" ||
        status === "compensation_failed",
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

  /**
   * Get aggregate stats for the workflow engine.
   */
  public async getStats(days?: number): Promise<WorkflowStats> {
    const workflows = this.workflowProvider.getRegisteredWorkflows();
    const periodAgo = this.toRawDate(
      this.dt
        .now()
        .subtract(days ?? 1, "day")
        .toISOString(),
    );

    // Postgres returns COUNT(*) as a bigint (string over the wire); SQLite
    // returns a plain number. The union + Number() below accepts either.
    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
          COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
          COUNT(*) FILTER (WHERE ${e.status} = 'completed' AND ${e.completedAt} >= ${periodAgo}) AS completed,
          COUNT(*) FILTER (WHERE ${e.status} = 'failed' AND ${e.completedAt} >= ${periodAgo}) AS failed,
          COUNT(*) FILTER (WHERE ${e.status} = 'compensated' AND ${e.completedAt} >= ${periodAgo}) AS compensated,
          COUNT(*) FILTER (WHERE ${e.status} = 'compensation_failed' AND ${e.completedAt} >= ${periodAgo}) AS compensation_failed,
          COUNT(*) FILTER (WHERE ${e.status} = 'cancelled' AND ${e.completedAt} >= ${periodAgo}) AS cancelled,
          COUNT(*) FILTER (WHERE ${e.status} = 'timed_out' AND ${e.completedAt} >= ${periodAgo}) AS timed_out
        FROM ${e}
      `,
      z.object({
        running: z.union([z.string(), z.number()]),
        pending: z.union([z.string(), z.number()]),
        completed: z.union([z.string(), z.number()]),
        failed: z.union([z.string(), z.number()]),
        compensated: z.union([z.string(), z.number()]),
        compensation_failed: z.union([z.string(), z.number()]),
        cancelled: z.union([z.string(), z.number()]),
        timed_out: z.union([z.string(), z.number()]),
      }),
    );

    const row = rows[0];
    return {
      registered: workflows.size,
      running: Number(row.running),
      pending: Number(row.pending),
      completed: Number(row.completed),
      failed: Number(row.failed),
      compensated: Number(row.compensated),
      compensationFailed: Number(row.compensation_failed),
      cancelled: Number(row.cancelled),
      timedOut: Number(row.timed_out),
    };
  }

  /**
   * Get the full workflow registry with live counts.
   */
  public async getWorkflowRegistry(): Promise<WorkflowRegistration[]> {
    const workflows = this.workflowProvider.getRegisteredWorkflows();
    const names = [...workflows.keys()];

    const countRows =
      names.length > 0
        ? await this.executions.query(
            (e) => sql`
              SELECT
                ${e.workflowName} AS workflow_name,
                COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
                COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
                COUNT(*) FILTER (WHERE ${e.status} = 'failed') AS failed
              FROM ${e}
              WHERE ${e.workflowName} IN (${sql.join(
                names.map((n) => sql`${n}`),
                sql`, `,
              )})
              GROUP BY ${e.workflowName}
            `,
            z.object({
              workflow_name: z.string(),
              running: z.union([z.string(), z.number()]),
              pending: z.union([z.string(), z.number()]),
              failed: z.union([z.string(), z.number()]),
            }),
          )
        : [];

    const countsByName = new Map(countRows.map((r) => [r.workflow_name, r]));

    const result: WorkflowRegistration[] = [];

    for (const [name, reg] of workflows) {
      const opts = reg.options;
      const counts = countsByName.get(name);

      result.push({
        name,
        stepCount: opts.steps.length,
        steps: opts.steps.map((step) => ({
          name: step.name,
          hasCompensate: Boolean(step.compensate),
          hasRetry: Boolean(step.retry),
          timeout: step.timeout
            ? this.dt.duration(step.timeout).toISOString()
            : undefined,
        })),
        onError: opts.onError ?? "compensate",
        timeout: opts.timeout
          ? this.dt.duration(opts.timeout).toISOString()
          : undefined,
        priority: opts.priority ?? "normal",
        tags: opts.tags,
        paused: this.workflowProvider.isWorkflowPaused(name),
        running: Number(counts?.running ?? 0),
        pending: Number(counts?.pending ?? 0),
        failed: Number(counts?.failed ?? 0),
      });
    }

    return result;
  }

  /**
   * Paginated query for workflow executions.
   */
  public async findWorkflowExecutions(query: WorkflowExecutionQuery = {}) {
    query.sort ??= "-createdAt";

    const where = this.executions.createQueryWhere();

    if (query.workflow) {
      where.workflowName = { eq: query.workflow };
    }

    if (query.status) {
      where.status = { eq: query.status };
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
      content: page.content.map((exec: WorkflowExecutionEntity) => ({
        ...exec,
        can: this.computeCan(exec.status),
      })),
    };
  }

  /**
   * Get a single workflow execution with step details.
   */
  public async getExecution(id: string) {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new NotFoundError(`Workflow execution not found: ${id}`);
    }

    const steps = await this.stepExecutions.findMany({
      where: { workflowExecutionId: { eq: id } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });

    return {
      ...execution,
      can: this.computeCan(execution.status),
      steps,
    };
  }

  /**
   * Get daily activity (completed/failed) over a date range.
   *
   * Postgres only — `generate_series` has no SQLite equivalent here; on
   * SQLite deployments this returns per-day rows without zero-filling.
   */
  public async getActivity(days = 14): Promise<WorkflowActivityPoint[]> {
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
          COALESCE(COUNT(*) FILTER (WHERE ${e.status} = 'failed'), 0) AS failed
        FROM date_series ds
        LEFT JOIN ${e} ON DATE(${e.completedAt}) = ds.date
          AND ${e.status} IN ('completed', 'failed')
        GROUP BY ds.date
        ORDER BY ds.date ASC
      `,
      z.object({
        date: z.string(),
        completed: z.union([z.string(), z.number()]),
        failed: z.union([z.string(), z.number()]),
      }),
    );

    return rows.map((row) => ({
      date: row.date,
      completed: Number(row.completed),
      failed: Number(row.failed),
    }));
  }

  /**
   * SQLite variant of {@link getActivity}: no `generate_series`, so days
   * with zero activity are filled in application code. `completedAt` is
   * stored as epoch milliseconds on SQLite.
   */
  protected async getActivitySqlite(
    days: number,
  ): Promise<WorkflowActivityPoint[]> {
    const from = this.dt
      .now()
      .subtract(days - 1, "day")
      .startOf("day");

    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          DATE(${e.completedAt} / 1000, 'unixepoch') AS date,
          COUNT(*) FILTER (WHERE ${e.status} = 'completed') AS completed,
          COUNT(*) FILTER (WHERE ${e.status} = 'failed') AS failed
        FROM ${e}
        WHERE ${e.status} IN ('completed', 'failed')
          AND ${e.completedAt} >= ${from.valueOf()}
        GROUP BY date
        ORDER BY date ASC
      `,
      z.object({
        date: z.string(),
        completed: z.union([z.string(), z.number()]),
        failed: z.union([z.string(), z.number()]),
      }),
    );

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const result: WorkflowActivityPoint[] = [];
    for (let i = 0; i < days; i++) {
      const date = from.add(i, "day").format("YYYY-MM-DD");
      const row = byDate.get(date);
      result.push({
        date,
        completed: Number(row?.completed ?? 0),
        failed: Number(row?.failed ?? 0),
      });
    }
    return result;
  }

  /**
   * Start a new workflow execution by name.
   */
  public async triggerWorkflow(
    name: string,
    payload?: Record<string, unknown>,
    options?: {
      key?: string;
      tags?: string[];
      triggeredBy?: string;
      triggeredByName?: string;
    },
  ): Promise<{ id: string }> {
    this.log.info(`Triggering workflow '${name}'`, {
      triggeredBy: options?.triggeredByName ?? options?.triggeredBy,
    });

    const id = await this.workflowProvider.start(name, payload ?? {}, {
      key: options?.key,
      tags: options?.tags,
      triggeredBy: options?.triggeredBy,
      triggeredByName: options?.triggeredByName,
    });

    return { id };
  }

  /**
   * Cancel a running workflow execution.
   */
  public async cancelWorkflowExecution(
    id: string,
    context?: {
      compensate?: boolean;
      cancelledBy?: string;
      cancelledByName?: string;
    },
  ): Promise<{ ok: boolean }> {
    this.log.info(`Cancelling workflow execution ${id}`, {
      cancelledBy: context?.cancelledByName ?? context?.cancelledBy,
    });

    await this.workflowProvider.cancel(id, {
      compensate: context?.compensate,
      cancelledBy: context?.cancelledBy,
      cancelledByName: context?.cancelledByName,
    });
    return { ok: true };
  }

  /**
   * Retry a failed/timed-out workflow from the failed step.
   */
  public async retryWorkflowExecution(id: string): Promise<{ ok: boolean }> {
    this.log.info(`Retrying workflow execution ${id}`);
    await this.workflowProvider.retry(id);
    return { ok: true };
  }

  /**
   * Restart a terminal workflow as a new execution.
   */
  public async restartWorkflowExecution(id: string): Promise<{ id: string }> {
    this.log.info(`Restarting workflow execution ${id}`);
    const newId = await this.workflowProvider.restart(id);
    return { id: newId };
  }

  /**
   * Trigger compensation on a failed/timed-out workflow.
   */
  public async compensateWorkflowExecution(
    id: string,
  ): Promise<{ ok: boolean }> {
    this.log.info(`Compensating workflow execution ${id}`);
    await this.workflowProvider.compensate(id);
    return { ok: true };
  }
}
