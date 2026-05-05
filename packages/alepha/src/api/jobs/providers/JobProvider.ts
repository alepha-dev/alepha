import {
  $hook,
  $inject,
  $state,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import type { LogEntry } from "alepha/logger";
import { $logger } from "alepha/logger";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import {
  type JobStatus,
  jobExecutionEntity,
} from "../entities/jobExecutionEntity.ts";
import type {
  JobPrimitiveOptions,
  JobPriority,
  JobRetryBackoff,
  JobRetryOptions,
} from "../primitives/$job.ts";
import { jobConfig } from "../schemas/jobConfigAtom.ts";

// -----------------------------------------------------------------------------------------------------------------

const PRIORITY_MAP: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const PRIORITY_REVERSE: Record<number, JobPriority> = {
  0: "critical",
  1: "high",
  2: "normal",
  3: "low",
};

// -----------------------------------------------------------------------------------------------------------------

export interface PushOptions {
  delay?: DurationLike;
  key?: string;
  priority?: JobPriority;
  scheduledAt?: Date;
  triggeredBy?: string;
  triggeredByName?: string;
}

export interface PushManyItem<T extends TSchema = TSchema> {
  payload: Static<T>;
  key?: string;
  delay?: DurationLike;
  priority?: JobPriority;
  scheduledAt?: Date;
}

export interface JobTriggerContext<T extends TSchema = TSchema> {
  payload?: Static<T>;
  triggeredBy?: string;
  triggeredByName?: string;
}

export interface CancelContext {
  cancelledBy?: string;
  cancelledByName?: string;
}

interface JobRuntimeRegistration {
  name: string;
  options: JobPrimitiveOptions;
  type: "cron" | "queue";
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * Coordinates cron (scheduler) and queue (push) jobs with a durable outbox
 * table and a single reconciliation sweep.
 *
 * Queue-mode flow:
 *   push()  → INSERT row (pending) + queue.send({ executionId })
 *   worker  → SELECT row → UPDATE running → handler → DELETE (ok) / UPDATE (error)
 *
 * Cron-mode flow:
 *   scheduler tick → handler runs inline → INSERT row only on error
 *
 * Sweep responsibilities (every `sweepCron`):
 *   - re-enqueue pending rows older than `staleThreshold`
 *   - fail running rows older than `max(timeout*2, runTimeout)`
 *   - move `scheduled` rows with `scheduledAt <= now` to pending + enqueue
 *   - trim per-job history beyond `keepLastSuccess` / `keepLastError`
 */
export class JobProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly cronProvider = $inject(CronProvider);
  protected readonly config = $state(jobConfig);
  protected readonly log = $logger();
  protected readonly executions = $repository(jobExecutionEntity);

  protected readonly jobs = new Map<string, JobRuntimeRegistration>();
  protected readonly inFlight = new Set<Promise<void>>();
  protected readonly abortControllers = new Map<string, AbortController>();
  protected readonly perExecutionLogs = new Map<string, LogEntry[]>();
  protected stopping = false;

  /**
   * Set by `JobQueueProvider` when `AlephaApiJobsQueue` is loaded.
   * When null, queue-mode jobs cannot be pushed.
   */
  public queueDispatch:
    | ((jobName: string, executionId: string) => Promise<void>)
    | null = null;

  // --- Registration -----------------------------------------------------------------------------------------------

  public registerJob(name: string, options: JobPrimitiveOptions): void {
    if (this.jobs.has(name)) {
      throw new AlephaError(`Job already registered: ${name}`);
    }
    if (options.cron && options.schema) {
      throw new AlephaError(
        `Job '${name}' declares both 'cron' and 'schema'. A job must be either cron-only (recurring) or queue-only (push-based). Split into two jobs.`,
      );
    }
    if (!options.cron && !options.schema) {
      throw new AlephaError(
        `Job '${name}' must declare either 'cron' (for recurring tasks) or 'schema' (for queue-mode tasks).`,
      );
    }

    const type: "cron" | "queue" = options.cron ? "cron" : "queue";
    this.jobs.set(name, { name, options, type });
    this.log.debug(`Registered ${type} job '${name}'`, {
      cron: options.cron,
      priority: options.priority ?? "normal",
      retries: options.retry?.retries ?? 0,
    });

    if (options.cron) {
      this.cronProvider.createCronJob(name, options.cron, async () => {
        try {
          await this.runCron(name);
        } catch (error) {
          this.log.error(`Cron tick failed for job '${name}'`, error);
        }
      });
    }
  }

  public getRegisteredJobs(): Map<string, JobRuntimeRegistration> {
    return this.jobs;
  }

  // --- Cron execution (inline, no queue) --------------------------------------------------------------------------

  protected async runCron(name: string): Promise<void> {
    const registration = this.getRegistration(name);
    if (registration.type !== "cron") {
      throw new AlephaError(`Job '${name}' is not cron-mode`);
    }
    if (this.stopping) return;

    const executionId = crypto.randomUUID();
    const promise = this.executeInline(registration, executionId, {
      payload: undefined,
      attempt: 1,
      triggeredBy: "system",
      triggeredByName: "system (cron)",
    });
    this.inFlight.add(promise);
    try {
      await promise;
    } finally {
      this.inFlight.delete(promise);
    }
  }

  /**
   * Execute a cron handler inline. Records a row only on error (or always,
   * when `record: 'all'`). No DB writes on the happy path by default.
   */
  protected async executeInline(
    registration: JobRuntimeRegistration,
    executionId: string,
    ctx: {
      payload: unknown;
      attempt: number;
      triggeredBy?: string;
      triggeredByName?: string;
    },
  ): Promise<void> {
    const opts = registration.options;
    const name = registration.name;
    const record = opts.record ?? "error";
    const contextId = this.alepha.context.createContextId();
    this.perExecutionLogs.set(contextId, []);

    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      const ms = this.dt.duration(opts.timeout).as("milliseconds");
      timeoutId = setTimeout(() => abortController.abort(), ms);
    }

    const startedAt = this.dt.now();

    try {
      await this.alepha.context.run(
        async () => {
          await this.alepha.events.emit("job:begin", {
            name,
            now: startedAt,
            executionId,
          });

          try {
            await opts.handler({
              payload: ctx.payload,
              attempt: ctx.attempt,
              now: startedAt,
              signal: abortController.signal,
              executionId,
            });

            if (record === "all") {
              await this.writeTerminalRow(executionId, name, "ok", {
                payload: ctx.payload,
                attempt: ctx.attempt,
                startedAt,
                error: undefined,
                context: contextId,
                triggeredBy: ctx.triggeredBy,
                triggeredByName: ctx.triggeredByName,
              });
            }

            await this.alepha.events.emit(
              "job:success",
              { name, executionId },
              { catch: true },
            );
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            if (record !== "none") {
              await this.writeTerminalRow(executionId, name, "error", {
                payload: ctx.payload,
                attempt: ctx.attempt,
                startedAt,
                error: err,
                context: contextId,
                triggeredBy: ctx.triggeredBy,
                triggeredByName: ctx.triggeredByName,
              });
            }
            await this.alepha.events.emit(
              "job:error",
              { name, error: err, executionId },
              { catch: true },
            );
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
            this.abortControllers.delete(executionId);
            await this.alepha.events.emit(
              "job:end",
              { name, executionId },
              { catch: true },
            );
          }
        },
        { context: contextId },
      );
    } finally {
      this.perExecutionLogs.delete(contextId);
    }
  }

  protected async writeTerminalRow(
    executionId: string,
    jobName: string,
    status: "ok" | "error",
    fields: {
      payload: unknown;
      attempt: number;
      startedAt: ReturnType<DateTimeProvider["now"]>;
      error?: Error;
      context: string;
      triggeredBy?: string;
      triggeredByName?: string;
    },
  ): Promise<void> {
    try {
      const logs =
        status === "error" ? this.snapshotLogs(fields.context) : undefined;
      await this.executions.create({
        id: executionId,
        jobName,
        status,
        payload: fields.payload as Record<string, unknown> | undefined,
        attempt: fields.attempt,
        maxAttempts: fields.attempt,
        startedAt: fields.startedAt.toISOString(),
        completedAt: this.dt.nowISOString(),
        error: fields.error?.message,
        logs,
        triggeredBy: fields.triggeredBy,
        triggeredByName: fields.triggeredByName,
      });
    } catch (e) {
      this.log.warn(`Failed to write terminal row for ${executionId}`, e);
    }
  }

  // --- Queue push -------------------------------------------------------------------------------------------------

  public async push(
    name: string,
    payload: unknown,
    options?: PushOptions,
  ): Promise<string> {
    const registration = this.getRegistration(name);
    if (registration.type !== "queue") {
      throw new AlephaError(
        `Job '${name}' is not queue-mode (no schema declared). Use trigger() instead.`,
      );
    }
    const opts = registration.options;
    const validated = this.alepha.codec.validate(opts.schema!, payload);

    const priority =
      PRIORITY_MAP[options?.priority ?? opts.priority ?? "normal"];
    const maxAttempts = (opts.retry?.retries ?? 0) + 1;

    const isDelayed = options?.delay || options?.scheduledAt;
    const status: JobStatus = isDelayed ? "scheduled" : "pending";

    let scheduledAt: string | undefined;
    if (options?.scheduledAt) {
      scheduledAt = options.scheduledAt.toISOString();
    } else if (options?.delay) {
      scheduledAt = this.dt
        .now()
        .add(this.dt.duration(options.delay))
        .toISOString();
    }

    if (options?.key) {
      // Key-based dedup: check for existing row first, then insert.
      // Two queries in the no-conflict path, but deterministic across dialects.
      const existing = await this.executions.findMany({
        where: { jobName: { eq: name }, key: { eq: options.key } },
        limit: 1,
      });
      if (existing.length > 0) {
        return existing[0].id;
      }
      const execution = await this.executions.create({
        jobName: name,
        key: options.key,
        payload: validated as Record<string, unknown>,
        status,
        priority,
        maxAttempts,
        scheduledAt,
        triggeredBy: options.triggeredBy,
        triggeredByName: options.triggeredByName,
      });
      if (status === "pending") {
        await this.dispatchToQueue(name, execution.id);
      } else if (status === "scheduled" && scheduledAt) {
        this.scheduleOptimisticDispatch(name, execution.id, scheduledAt);
      }
      return execution.id;
    }

    const execution = await this.executions.create({
      jobName: name,
      payload: validated as Record<string, unknown>,
      status,
      priority,
      maxAttempts,
      scheduledAt,
      triggeredBy: options?.triggeredBy,
      triggeredByName: options?.triggeredByName,
    });

    if (status === "pending") {
      await this.dispatchToQueue(name, execution.id);
    } else if (status === "scheduled" && scheduledAt) {
      this.scheduleOptimisticDispatch(name, execution.id, scheduledAt);
    }
    return execution.id;
  }

  /**
   * Fire a local setTimeout so delayed/retrying rows dispatch as close to
   * `scheduledAt` as possible, rather than waiting for the next sweep tick.
   * No-op on stateless runtimes where timers won't survive (the sweep
   * handles those).
   */
  protected scheduleOptimisticDispatch(
    jobName: string,
    executionId: string,
    scheduledAt: string,
  ): void {
    const delayMs = Math.max(
      0,
      new Date(scheduledAt).getTime() - this.dt.nowMillis(),
    );
    this.dt.createTimeout(() => {
      void this.dispatchScheduled(jobName, executionId);
    }, delayMs);
  }

  public async pushMany(
    name: string,
    items: Array<PushManyItem>,
  ): Promise<string[]> {
    if (items.length === 0) return [];

    const registration = this.getRegistration(name);
    if (registration.type !== "queue") {
      throw new AlephaError(
        `Job '${name}' is not queue-mode (no schema declared).`,
      );
    }
    const opts = registration.options;
    const maxAttempts = (opts.retry?.retries ?? 0) + 1;

    const keyed: PushManyItem[] = [];
    const bulk: Array<{
      jobName: string;
      payload: Record<string, unknown>;
      status: JobStatus;
      priority: number;
      maxAttempts: number;
      scheduledAt?: string;
    }> = [];

    for (const item of items) {
      const validated = this.alepha.codec.validate(opts.schema!, item.payload);
      if (item.key) {
        keyed.push({ ...item, payload: validated as Static<TSchema> });
        continue;
      }
      const isDelayed = item.delay || item.scheduledAt;
      const status: JobStatus = isDelayed ? "scheduled" : "pending";
      let scheduledAt: string | undefined;
      if (item.scheduledAt) {
        scheduledAt = item.scheduledAt.toISOString();
      } else if (item.delay) {
        scheduledAt = this.dt
          .now()
          .add(this.dt.duration(item.delay))
          .toISOString();
      }
      bulk.push({
        jobName: name,
        payload: validated as Record<string, unknown>,
        status,
        priority: PRIORITY_MAP[item.priority ?? opts.priority ?? "normal"],
        maxAttempts,
        scheduledAt,
      });
    }

    const ids: string[] = [];

    for (const item of keyed) {
      const id = await this.push(name, item.payload, {
        key: item.key,
        delay: item.delay,
        priority: item.priority,
        scheduledAt: item.scheduledAt,
      });
      ids.push(id);
    }

    if (bulk.length > 0) {
      const created = await this.executions.createMany(bulk);
      for (const exec of created) {
        ids.push(exec.id);
        if (exec.status === "pending" && !this.stopping) {
          await this.dispatchToQueue(name, exec.id);
        } else if (
          exec.status === "scheduled" &&
          exec.scheduledAt &&
          !this.stopping
        ) {
          this.scheduleOptimisticDispatch(name, exec.id, exec.scheduledAt);
        }
      }
    }

    this.log.debug(`pushMany '${name}': ${ids.length} jobs created`, {
      bulk: bulk.length,
      keyed: keyed.length,
    });

    return ids;
  }

  protected async dispatchToQueue(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    if (this.stopping) return;
    if (!this.queueDispatch) {
      throw new AlephaError(
        `Queue-mode job '${jobName}' cannot be pushed: AlephaApiJobsQueue is not loaded. Add '.with(AlephaApiJobsQueue)' to your app.`,
      );
    }
    await this.queueDispatch(jobName, executionId);
  }

  // --- Manual trigger (admin / CLI) ------------------------------------------------------------------------------

  public async trigger(
    name: string,
    context?: JobTriggerContext,
  ): Promise<void> {
    const registration = this.getRegistration(name);

    if (registration.type === "cron") {
      const executionId = crypto.randomUUID();
      await this.executeInline(registration, executionId, {
        payload: undefined,
        attempt: 1,
        triggeredBy: context?.triggeredBy,
        triggeredByName: context?.triggeredByName,
      });
      return;
    }

    // queue-mode: treat as a normal push with the given payload
    if (!context?.payload) {
      throw new AlephaError(
        `Queue-mode job '${name}' requires a payload for manual trigger.`,
      );
    }
    await this.push(name, context.payload, {
      triggeredBy: context.triggeredBy,
      triggeredByName: context.triggeredByName,
    });
  }

  // --- Cancel ----------------------------------------------------------------------------------------------------

  public async cancel(
    executionId: string,
    context?: CancelContext,
  ): Promise<void> {
    const execution = await this.executions.findById(executionId);
    if (!execution) {
      throw new AlephaError(`Execution not found: ${executionId}`);
    }
    if (
      execution.status === "ok" ||
      execution.status === "error" ||
      execution.status === "cancelled"
    ) {
      throw new AlephaError(
        `Cannot cancel execution in '${execution.status}' status`,
      );
    }

    const controller = this.abortControllers.get(executionId);
    if (controller) controller.abort();

    await this.executions.updateById(executionId, {
      status: "cancelled",
      key: null,
      cancelledBy: context?.cancelledBy,
      cancelledByName: context?.cancelledByName,
      completedAt: this.dt.nowISOString(),
    });

    this.log.info(`Cancelled execution ${executionId}`, {
      jobName: execution.jobName,
      cancelledBy: context?.cancelledByName ?? context?.cancelledBy,
    });
  }

  // --- Queue consumer (called by JobQueueProvider) --------------------------------------------------------------

  public async processExecution(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    const registration = this.jobs.get(jobName);
    if (!registration) {
      this.log.warn(`Unknown job '${jobName}' — skipping execution`, {
        executionId,
      });
      return;
    }
    if (registration.type !== "queue") {
      this.log.warn(`Job '${jobName}' is not queue-mode — skipping`, {
        executionId,
      });
      return;
    }

    const promise = this.processQueueExecution(registration, executionId);
    this.inFlight.add(promise);
    try {
      await promise;
    } finally {
      this.inFlight.delete(promise);
    }
  }

  protected async processQueueExecution(
    registration: JobRuntimeRegistration,
    executionId: string,
  ): Promise<void> {
    const jobName = registration.name;
    const opts = registration.options;
    const record = opts.record ?? "error";

    const execution = await this.claim(executionId);
    if (!execution) {
      this.log.debug(`Execution ${executionId} already claimed, skipping`);
      return;
    }

    const contextId = this.alepha.context.createContextId();
    this.perExecutionLogs.set(contextId, []);

    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      const ms = this.dt.duration(opts.timeout).as("milliseconds");
      timeoutId = setTimeout(() => abortController.abort(), ms);
    }

    const now = this.dt.now();

    try {
      await this.alepha.context.run(
        async () => {
          await this.alepha.events.emit("job:begin", {
            name: jobName,
            now,
            executionId,
          });

          try {
            await opts.handler({
              payload: execution.payload,
              attempt: execution.attempt,
              now,
              signal: abortController.signal,
              executionId,
            });

            // Success: either DELETE (keepLastSuccess=0 or record=error)
            // or UPDATE to 'ok' (record=all and keepLastSuccess>0).
            const keepSuccess =
              record === "all" && this.config.keepLastSuccess > 0;
            if (keepSuccess) {
              await this.executions.updateById(executionId, {
                status: "ok",
                completedAt: this.dt.nowISOString(),
                key: null,
              });
            } else {
              await this.executions.deleteById(executionId);
            }

            await this.alepha.events.emit(
              "job:success",
              { name: jobName, executionId },
              { catch: true },
            );
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));

            if (abortController.signal.aborted) {
              const current = await this.executions.findById(executionId);
              if (current?.status === "cancelled") {
                await this.alepha.events.emit(
                  "job:cancel",
                  { name: jobName, executionId },
                  { catch: true },
                );
                return;
              }
            }

            await this.handleFailure(
              executionId,
              registration,
              execution.attempt,
              err,
              contextId,
            );
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
            this.abortControllers.delete(executionId);
            await this.alepha.events.emit(
              "job:end",
              { name: jobName, executionId },
              { catch: true },
            );
          }
        },
        { context: contextId },
      );
    } finally {
      this.perExecutionLogs.delete(contextId);
    }
  }

  /**
   * Transition pending → running and return the post-update row.
   * Two round-trips: read current attempt, then guarded UPDATE … RETURNING.
   * Returns null when the row is gone or already claimed by another worker.
   * The returned row replaces a separate post-claim findById, so the dispatch
   * path is 2 queries instead of 3.
   */
  protected async claim(executionId: string) {
    const current = await this.executions.findById(executionId);
    if (!current) return null;
    try {
      return await this.executions.updateOne(
        { id: { eq: executionId }, status: { eq: "pending" } },
        {
          status: "running",
          attempt: current.attempt + 1,
          startedAt: this.dt.nowISOString(),
        },
      );
    } catch (e) {
      if (e instanceof DbEntityNotFoundError) return null;
      throw e;
    }
  }

  protected async handleFailure(
    executionId: string,
    registration: JobRuntimeRegistration,
    currentAttempt: number,
    error: Error,
    contextId: string,
  ): Promise<void> {
    const jobName = registration.name;
    const opts = registration.options;
    const retry = opts.retry;
    const maxAttempts = (retry?.retries ?? 0) + 1;

    const canRetry =
      retry &&
      currentAttempt + 1 < maxAttempts &&
      (retry.when ? retry.when(error) : true);

    if (canRetry) {
      const nextScheduledAt = this.computeBackoff(retry, currentAttempt + 1);
      this.log.info(
        `Job '${jobName}' failed, scheduling retry ${currentAttempt + 1}/${maxAttempts}`,
        { executionId, error: error.message, nextScheduledAt },
      );
      await this.executions.updateById(executionId, {
        status: "scheduled",
        error: error.message,
        scheduledAt: nextScheduledAt,
        logs: this.snapshotLogs(contextId),
      });
      // Optimistic dispatch: fire a local timer so the retry runs as close to
      // `scheduledAt` as possible. The sweep is the safety net for worker
      // crashes and stateless runtimes (CF Workers, where setTimeout won't
      // survive across invocations anyway).
      const delayMs = Math.max(
        0,
        new Date(nextScheduledAt).getTime() - this.dt.nowMillis(),
      );
      this.dt.createTimeout(() => {
        void this.dispatchScheduled(jobName, executionId);
      }, delayMs);
    } else {
      this.log.info(
        `Job '${jobName}' dead after ${currentAttempt} attempt(s)`,
        { executionId, error: error.message },
      );
      await this.executions.updateById(executionId, {
        status: "error",
        error: error.message,
        completedAt: this.dt.nowISOString(),
        key: null,
        logs: this.snapshotLogs(contextId),
      });
    }

    await this.alepha.events.emit(
      "job:error",
      { name: jobName, error, executionId },
      { catch: true },
    );
  }

  protected computeBackoff(retry: JobRetryOptions, attempt: number): string {
    const now = this.dt.now();
    if (!retry.backoff) {
      return now.add(1, "second").toISOString();
    }
    if (Array.isArray(retry.backoff)) {
      return now.add(this.dt.duration(retry.backoff)).toISOString();
    }
    const backoff = retry.backoff as JobRetryBackoff;
    const initial = this.dt.duration(backoff.initial).as("milliseconds");
    const factor = backoff.factor ?? 2;
    let delayMs = initial * factor ** (attempt - 1);
    if (backoff.max) {
      delayMs = Math.min(
        delayMs,
        this.dt.duration(backoff.max).as("milliseconds"),
      );
    }
    if (backoff.jitter) {
      delayMs = delayMs * (0.75 + Math.random() * 0.5);
    }
    return now.add(delayMs, "millisecond").toISOString();
  }

  protected snapshotLogs(contextId: string): LogEntry[] | undefined {
    const entries = this.perExecutionLogs.get(contextId);
    if (!entries || entries.length === 0) return undefined;
    const max = this.config.logMaxEntries;
    if (max === 0) return undefined;
    if (entries.length <= max) return [...entries];
    const truncated = entries.slice(0, max);
    truncated.push({
      level: "WARN",
      message: `Log entries truncated at ${max}`,
      timestamp: this.dt.nowMillis(),
      service: "alepha.jobs",
      module: "JobProvider",
    } as LogEntry);
    return truncated;
  }

  // --- Sweep ----------------------------------------------------------------------------------------------------

  protected async sweep(): Promise<void> {
    if (this.stopping) return;
    this.log.trace("Starting job sweep");
    const now = this.dt.now();
    const nowIso = now.toISOString();

    try {
      // 1. Due scheduled rows → pending + dispatch
      const dueWhere = this.executions.createQueryWhere();
      dueWhere.status = { eq: "scheduled" };
      dueWhere.scheduledAt = { lte: nowIso };
      const due = await this.executions.findMany({
        where: dueWhere,
        orderBy: { column: "priority", direction: "asc" },
      });
      for (const exec of due) {
        if (!this.jobs.has(exec.jobName)) continue;
        await this.executions.updateById(exec.id, { status: "pending" });
        await this.dispatchToQueueSafe(exec.jobName, exec.id);
      }

      // 2. Stale pending rows → re-dispatch
      const staleIso = now
        .subtract(this.config.staleThreshold, "millisecond")
        .toISOString();
      const staleWhere = this.executions.createQueryWhere();
      staleWhere.status = { eq: "pending" };
      staleWhere.createdAt = { lte: staleIso };
      const stale = await this.executions.findMany({
        where: staleWhere,
        orderBy: { column: "priority", direction: "asc" },
      });
      for (const exec of stale) {
        if (!this.jobs.has(exec.jobName)) continue;
        await this.dispatchToQueueSafe(exec.jobName, exec.id);
      }

      // 3. Crashed running rows → mark as failed + apply retry
      const runningWhere = this.executions.createQueryWhere();
      runningWhere.status = { eq: "running" };
      const running = await this.executions.findMany({ where: runningWhere });
      const nowMs = now.valueOf();
      for (const exec of running) {
        const reg = this.jobs.get(exec.jobName);
        if (!reg) continue;
        if (this.abortControllers.has(exec.id)) continue; // still alive locally
        const crashThresholdMs = reg.options.timeout
          ? this.dt.duration(reg.options.timeout).as("milliseconds") * 2
          : this.config.runTimeout;
        const startedAtMs = exec.startedAt
          ? new Date(exec.startedAt).getTime()
          : 0;
        if (startedAtMs > 0 && nowMs - startedAtMs > crashThresholdMs) {
          this.log.warn(
            `Sweep: marking crashed ${exec.jobName} (${exec.id}) as failed`,
          );
          const err = new Error(
            "Execution assumed crashed (recovered by sweep)",
          );
          await this.handleFailure(exec.id, reg, exec.attempt, err, "");
        }
      }

      // 4. Trim ring buffer per job
      await this.trimRingBuffers();
    } catch (e) {
      this.log.error("Sweep failed", { error: e });
    }
  }

  protected async dispatchToQueueSafe(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.dispatchToQueue(jobName, executionId);
    } catch (e) {
      this.log.warn(`Sweep failed to dispatch ${jobName} (${executionId})`, e);
    }
  }

  /**
   * Move a row from `scheduled` → `pending` and dispatch it.
   * Used by the optimistic retry/delay timer. If the sweep has already moved
   * the row, or another worker has claimed it, the UPDATE guard fails silently.
   */
  protected async dispatchScheduled(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    if (this.stopping) return;
    try {
      await this.executions.updateOne(
        { id: { eq: executionId }, status: { eq: "scheduled" } },
        { status: "pending" },
      );
      await this.dispatchToQueueSafe(jobName, executionId);
    } catch {
      // Row already transitioned (sweep ran, another worker claimed, etc.)
    }
  }

  protected async trimRingBuffers(): Promise<void> {
    for (const [jobName, reg] of this.jobs) {
      const okLimit = reg.options.keep?.ok ?? this.config.keepLastSuccess;
      const errLimit = reg.options.keep?.error ?? this.config.keepLastError;
      if (okLimit > 0) {
        await this.trimByStatus(jobName, "ok", okLimit);
      }
      if (errLimit > 0) {
        await this.trimByStatus(jobName, "error", errLimit);
      }
    }
  }

  protected async trimByStatus(
    jobName: string,
    status: "ok" | "error",
    keep: number,
  ): Promise<void> {
    try {
      const rows = await this.executions.findMany({
        where: { jobName: { eq: jobName }, status: { eq: status } },
        orderBy: { column: "startedAt", direction: "desc" },
        limit: keep + 50,
      });
      if (rows.length <= keep) return;
      const toDelete = rows.slice(keep).map((r) => r.id);
      if (toDelete.length > 0) {
        await this.executions.deleteMany({ id: { inArray: toDelete } });
        this.log.debug(
          `Trimmed ${toDelete.length} ${status} rows for '${jobName}'`,
        );
      }
    } catch (e) {
      this.log.warn(`Failed to trim ${status} rows for '${jobName}'`, e);
    }
  }

  // --- Lifecycle -----------------------------------------------------------------------------------------------

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Validate that queue-mode jobs have a dispatcher registered.
      const needsQueue = [...this.jobs.values()].some(
        (j) => j.type === "queue",
      );
      if (needsQueue && !this.queueDispatch) {
        throw new AlephaError(
          `Queue-mode jobs are registered but no queue dispatcher is available. Add '.with(AlephaApiJobsQueue)' to your app.`,
        );
      }

      this.log.info(`Job system OK`, {
        dispatch: this.queueDispatch ? "queue" : "inline-only",
        jobs: this.jobs.size,
      });

      // Capture logs per execution context.
      this.alepha.events.on("log", ({ entry }) => {
        const ctx = entry.context;
        if (!ctx) return;
        const entries = this.perExecutionLogs.get(ctx);
        if (!entries) return;
        entries.push(entry);
      });

      if (!this.alepha.isServerless()) {
        await this.sweep();
      }

      this.cronProvider.createCronJob(
        "api:jobs:sweep",
        this.config.sweepCron,
        async () => {
          await this.sweep();
        },
        true,
      );
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      this.stopping = true;
      if (this.inFlight.size > 0) {
        this.log.info(`Draining ${this.inFlight.size} in-flight job(s)...`);
        await Promise.race([
          Promise.allSettled([...this.inFlight]),
          this.dt.wait([this.config.drainTimeout, "millisecond"]),
        ]);
      }
      if (this.abortControllers.size > 0) {
        this.log.warn(
          `Aborting ${this.abortControllers.size} remaining job(s) after drain timeout`,
        );
        for (const controller of this.abortControllers.values()) {
          controller.abort();
        }
      }
    },
  });

  // --- Helpers -------------------------------------------------------------------------------------------------

  protected getRegistration(name: string): JobRuntimeRegistration {
    const registration = this.jobs.get(name);
    if (!registration) {
      throw new AlephaError(`Job not registered: ${name}`);
    }
    return registration;
  }
}

export { PRIORITY_MAP, PRIORITY_REVERSE };
