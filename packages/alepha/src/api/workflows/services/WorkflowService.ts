import { $inject, Alepha, t } from "alepha";
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
  protected computeCan(
    status: string,
    signalStepName?: string,
  ): WorkflowExecutionCan {
    return {
      retry: status === "failed" || status === "timed_out",
      cancel:
        status === "pending" ||
        status === "running" ||
        status === "waiting_for_signal",
      compensate: status === "failed" || status === "timed_out",
      restart:
        status === "failed" ||
        status === "compensated" ||
        status === "compensation_failed",
      signal: signalStepName ? { stepName: signalStepName } : undefined,
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

    const rows = await this.executions.query(
      (e) => sql`
        SELECT
          COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
          COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
          COUNT(*) FILTER (WHERE ${e.status} = 'waiting_for_signal') AS waiting,
          COUNT(*) FILTER (WHERE ${e.status} = 'completed' AND ${e.completedAt} >= ${periodAgo}) AS completed,
          COUNT(*) FILTER (WHERE ${e.status} = 'failed' AND ${e.completedAt} >= ${periodAgo}) AS failed,
          COUNT(*) FILTER (WHERE ${e.status} = 'compensated' AND ${e.completedAt} >= ${periodAgo}) AS compensated,
          COUNT(*) FILTER (WHERE ${e.status} = 'compensation_failed' AND ${e.completedAt} >= ${periodAgo}) AS compensation_failed,
          COUNT(*) FILTER (WHERE ${e.status} = 'cancelled' AND ${e.completedAt} >= ${periodAgo}) AS cancelled,
          COUNT(*) FILTER (WHERE ${e.status} = 'timed_out' AND ${e.completedAt} >= ${periodAgo}) AS timed_out
        FROM ${e}
      `,
      t.object({
        running: t.string(),
        pending: t.string(),
        waiting: t.string(),
        completed: t.string(),
        failed: t.string(),
        compensated: t.string(),
        compensation_failed: t.string(),
        cancelled: t.string(),
        timed_out: t.string(),
      }),
    );

    const row = rows[0];
    return {
      registered: workflows.size,
      running: Number(row.running),
      pending: Number(row.pending),
      waiting: Number(row.waiting),
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
  public async getRegistry(): Promise<WorkflowRegistration[]> {
    const workflows = this.workflowProvider.getRegisteredWorkflows();
    const names = [...workflows.keys()];

    // Get live counts per workflow name
    const countRows =
      names.length > 0
        ? await this.executions.query(
            (e) => sql`
              SELECT
                ${e.workflowName} AS workflow_name,
                COUNT(*) FILTER (WHERE ${e.status} = 'running') AS running,
                COUNT(*) FILTER (WHERE ${e.status} = 'pending') AS pending,
                COUNT(*) FILTER (WHERE ${e.status} = 'waiting_for_signal') AS waiting,
                COUNT(*) FILTER (WHERE ${e.status} = 'failed') AS failed
              FROM ${e}
              WHERE ${e.workflowName} IN (${sql.join(
                names.map((n) => sql`${n}`),
                sql`, `,
              )})
              GROUP BY ${e.workflowName}
            `,
            t.object({
              workflow_name: t.string(),
              running: t.string(),
              pending: t.string(),
              waiting: t.string(),
              failed: t.string(),
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
          type: step.type ?? "handler",
          hasCompensate: Boolean(step.compensate),
          hasRetry: Boolean(step.retry),
          timeout: step.timeout ? String(step.timeout) : undefined,
        })),
        onError: opts.onError ?? "compensate",
        timeout: opts.timeout ? String(opts.timeout) : undefined,
        priority: opts.priority ?? "normal",
        tags: opts.tags,
        paused: this.workflowProvider.isWorkflowPaused(name),
        running: Number(counts?.running ?? 0),
        pending: Number(counts?.pending ?? 0),
        waiting: Number(counts?.waiting ?? 0),
        failed: Number(counts?.failed ?? 0),
      });
    }

    return result;
  }

  /**
   * Paginated query for workflow executions.
   */
  public async findExecutions(query: WorkflowExecutionQuery = {}) {
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

    // Determine signal step name if workflow is waiting
    let signalStepName: string | undefined;
    if (execution.status === "waiting_for_signal") {
      const waitingStep = steps.find((s) => s.status === "waiting");
      if (waitingStep) {
        signalStepName = waitingStep.stepName;
      }
    }

    return {
      ...execution,
      can: this.computeCan(execution.status, signalStepName),
      steps,
    };
  }

  /**
   * Get daily activity (completed/failed) over a date range.
   */
  public async getActivity(days = 14): Promise<WorkflowActivityPoint[]> {
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
  public async cancelExecution(
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
  public async retryExecution(id: string): Promise<{ ok: boolean }> {
    this.log.info(`Retrying workflow execution ${id}`);
    await this.workflowProvider.retry(id);
    return { ok: true };
  }

  /**
   * Restart a terminal workflow as a new execution.
   */
  public async restartExecution(id: string): Promise<{ id: string }> {
    this.log.info(`Restarting workflow execution ${id}`);
    const newId = await this.workflowProvider.restart(id);
    return { id: newId };
  }

  /**
   * Trigger compensation on a failed/timed-out workflow.
   */
  public async compensateExecution(id: string): Promise<{ ok: boolean }> {
    this.log.info(`Compensating workflow execution ${id}`);
    await this.workflowProvider.compensate(id);
    return { ok: true };
  }

  /**
   * Send a signal to a waiting workflow step.
   */
  public async signalExecution(
    id: string,
    stepName: string,
    payload?: Record<string, unknown>,
    signalledBy?: string,
  ): Promise<{ ok: boolean }> {
    this.log.info(`Signalling workflow execution ${id} step '${stepName}'`, {
      signalledBy,
    });
    await this.workflowProvider.signal(id, stepName, payload);
    return { ok: true };
  }
}
