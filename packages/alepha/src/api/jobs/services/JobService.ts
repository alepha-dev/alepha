import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
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

const PRIORITY_REVERSE: Record<number, string> = {
  0: "critical",
  1: "high",
  2: "normal",
  3: "low",
};

// -----------------------------------------------------------------------------------------------------------------

export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly jobProvider = $inject(JobProvider);
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

  public async getStats(): Promise<JobStats> {
    const jobs = this.jobProvider.getRegisteredJobs();

    const now = this.dt.now();
    const twentyFourHoursAgo = now.subtract(24, "hour").toISOString();

    const where = this.executions.createQueryWhere();

    // Count by status
    const allExecutions = await this.executions.findMany({ where });

    let running = 0;
    let pending = 0;
    let scheduled = 0;
    let retrying = 0;
    let dead = 0;
    let completed24h = 0;
    let failed24h = 0;

    for (const exec of allExecutions) {
      switch (exec.status) {
        case "running":
          running++;
          break;
        case "pending":
          pending++;
          break;
        case "scheduled":
          scheduled++;
          break;
        case "retrying":
          retrying++;
          break;
        case "dead":
          dead++;
          break;
      }

      if (exec.completedAt && exec.completedAt >= twentyFourHoursAgo) {
        if (exec.status === "completed") {
          completed24h++;
        }
        if (exec.status === "dead" || exec.status === "failed") {
          failed24h++;
        }
      }
    }

    return {
      registered: jobs.size,
      running,
      pending,
      scheduled,
      retrying,
      dead,
      completed24h,
      failed24h,
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
    await this.jobProvider.cancel(id, {
      cancelledBy: context?.cancelledBy,
      cancelledByName: context?.cancelledByName,
    });
    return { ok: true };
  }

  public async getCronJobs(): Promise<JobCronInfo[]> {
    const jobs = this.jobProvider.getRegisteredJobs();
    const result: JobCronInfo[] = [];

    for (const [name, reg] of jobs) {
      const opts = reg.options;
      if (!opts.cron) continue;

      const where = this.executions.createQueryWhere();
      where.jobName = { eq: name };
      const executions = await this.executions.findMany({ where });
      executions.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      const last = executions[0];

      result.push({
        name,
        cron: opts.cron,
        lock: opts.lock !== false,
        priority: (opts.priority ?? "normal") as JobCronInfo["priority"],
        concurrency: opts.concurrency ?? 1,
        hasSchema: Boolean(opts.schema),
        lastExecution: last
          ? {
              id: last.id,
              status: last.status,
              startedAt: last.startedAt,
              completedAt: last.completedAt,
              error: last.error,
            }
          : undefined,
      });
    }

    return result;
  }

  public async getQueueDepth(): Promise<JobQueueDepth[]> {
    const jobs = this.jobProvider.getRegisteredJobs();
    const where = this.executions.createQueryWhere();
    where.status = {
      inArray: ["pending", "running", "scheduled", "retrying", "dead"],
    };

    const allExecutions = await this.executions.findMany({ where });

    const counts = new Map<
      string,
      {
        pending: number;
        running: number;
        scheduled: number;
        retrying: number;
        dead: number;
      }
    >();

    for (const exec of allExecutions) {
      let entry = counts.get(exec.jobName);
      if (!entry) {
        entry = { pending: 0, running: 0, scheduled: 0, retrying: 0, dead: 0 };
        counts.set(exec.jobName, entry);
      }
      if (
        exec.status === "pending" ||
        exec.status === "running" ||
        exec.status === "scheduled" ||
        exec.status === "retrying" ||
        exec.status === "dead"
      ) {
        entry[exec.status]++;
      }
    }

    const result: JobQueueDepth[] = [];
    for (const [name, reg] of jobs) {
      const entry = counts.get(name) ?? {
        pending: 0,
        running: 0,
        scheduled: 0,
        retrying: 0,
        dead: 0,
      };
      result.push({
        jobName: name,
        ...entry,
        concurrency: reg.options.concurrency ?? 1,
      });
    }

    return result;
  }

  public async getActivity(days = 14): Promise<JobActivityPoint[]> {
    const now = this.dt.now();
    const cutoff = now.subtract(days, "day").toISOString();

    const where = this.executions.createQueryWhere();
    where.completedAt = { gte: cutoff };
    where.status = { inArray: ["completed", "dead", "failed"] };

    const allExecutions = await this.executions.findMany({ where });

    const dayMap = new Map<string, { completed: number; failed: number }>();

    // Pre-fill all days so the chart has no gaps
    for (let i = days - 1; i >= 0; i--) {
      const date = now.subtract(i, "day").format("YYYY-MM-DD");
      dayMap.set(date, { completed: 0, failed: 0 });
    }

    for (const exec of allExecutions) {
      if (!exec.completedAt) continue;
      const date = exec.completedAt.substring(0, 10);
      let entry = dayMap.get(date);
      if (!entry) {
        entry = { completed: 0, failed: 0 };
        dayMap.set(date, entry);
      }
      if (exec.status === "completed") {
        entry.completed++;
      } else {
        entry.failed++;
      }
    }

    const result: JobActivityPoint[] = [];
    for (const [date, data] of dayMap) {
      result.push({ date, ...data });
    }
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  public async getTopFailures(): Promise<JobFailure[]> {
    const now = this.dt.now();
    const sevenDaysAgo = now.subtract(7, "day").toISOString();

    const where = this.executions.createQueryWhere();
    where.status = { inArray: ["dead", "failed"] };
    where.completedAt = { gte: sevenDaysAgo };

    const allFailures = await this.executions.findMany({ where });

    const grouped = new Map<string, { failures: number; lastError?: string }>();

    for (const exec of allFailures) {
      let entry = grouped.get(exec.jobName);
      if (!entry) {
        entry = { failures: 0 };
        grouped.set(exec.jobName, entry);
      }
      entry.failures++;
      if (exec.error) {
        entry.lastError = exec.error;
      }
    }

    const result: JobFailure[] = [];
    for (const [jobName, data] of grouped) {
      result.push({ jobName, ...data });
    }

    result.sort((a, b) => b.failures - a.failures);
    return result;
  }
}
