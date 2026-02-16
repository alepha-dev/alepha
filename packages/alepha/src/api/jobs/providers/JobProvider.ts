import {
  $hook,
  $inject,
  $use,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
  t,
} from "alepha";
import {
  DateTimeProvider,
  type DurationLike,
  type Interval,
} from "alepha/datetime";
import type { LogEntry } from "alepha/logger";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $queue } from "alepha/queue";
import { CronProvider } from "alepha/scheduler";
import {
  type JobStatus,
  jobExecutionEntity,
} from "../entities/jobExecutionEntity.ts";
import { jobExecutionLogEntity } from "../entities/jobExecutionLogEntity.ts";
import type {
  JobItem,
  JobPrimitiveOptions,
  JobPriority,
  JobRetryBackoff,
  JobRetryOptions,
} from "../primitives/$job.ts";
import { jobConfig } from "../schemas/jobConfigAtom.ts";

// -----------------------------------------------------------------------------------------------------------------

const PRIORITY_MAP: Record<string, number> = {
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
}

export interface PushManyItem<T extends TSchema = TSchema> {
  payload: Static<T>;
  key?: string;
  delay?: DurationLike;
  priority?: JobPriority;
  scheduledAt?: Date;
}

export interface JobTriggerContext {
  payload?: Record<string, unknown>;
  triggeredBy?: string;
  triggeredByName?: string;
}

export interface CancelContext {
  cancelledBy?: string;
  cancelledByName?: string;
}

interface JobRegistration {
  name: string;
  options: JobPrimitiveOptions;
}

// -----------------------------------------------------------------------------------------------------------------

export class JobProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly cronProvider = $inject(CronProvider);
  protected readonly config = $use(jobConfig);
  protected readonly log = $logger();
  protected readonly executions = $repository(jobExecutionEntity);
  protected readonly executionLogs = $repository(jobExecutionLogEntity);

  protected readonly dispatchQueue = $queue({
    name: "_alepha:jobs:dispatch",
    schema: t.object({ jobName: t.text(), executionId: t.text() }),
    handler: async (msg) => {
      await this.processExecution(msg.payload.jobName, msg.payload.executionId);
    },
  });

  protected readonly jobs = new Map<string, JobRegistration>();
  protected readonly logs = new Map<string, LogEntry[]>();
  protected readonly abortControllers = new Map<string, AbortController>();
  protected readonly sweepIntervals: Interval[] = [];
  protected stopping = false;
  protected workerId = "";

  // --- Registration ---

  public registerJob(name: string, options: JobPrimitiveOptions): void {
    if (this.jobs.has(name)) {
      throw new AlephaError(`Job already registered: ${name}`);
    }

    this.jobs.set(name, { name, options });

    if (options.cron) {
      this.cronProvider.createCronJob(name, options.cron, () =>
        this.trigger(name, {
          triggeredBy: "system",
          triggeredByName: "system (cron)",
        }),
      );
    }
  }

  /**
   * Get all registered job definitions.
   */
  public getRegisteredJobs(): Map<string, JobRegistration> {
    return this.jobs;
  }

  // --- Push ---

  public async push(
    name: string,
    payload: unknown,
    options?: PushOptions,
  ): Promise<string> {
    const registration = this.getRegistration(name);
    const opts = registration.options;

    if (!opts.schema) {
      throw new AlephaError(
        `Cannot push to job '${name}': no schema defined. Use trigger() for cron-only jobs.`,
      );
    }

    const validated = this.alepha.codec.validate(opts.schema, payload);

    const priority =
      PRIORITY_MAP[options?.priority ?? opts.priority ?? "normal"];
    const maxAttempts = (opts.retry?.retries ?? 0) + 1;

    const isDelayed = options?.delay || options?.scheduledAt;
    const status: JobStatus = isDelayed ? "scheduled" : "pending";

    let scheduledAt: string | undefined;
    if (options?.scheduledAt) {
      scheduledAt = options.scheduledAt.toISOString();
    } else if (options?.delay) {
      const now = this.dt.now();
      scheduledAt = now.add(this.dt.duration(options.delay)).toISOString();
    }

    // Keyed path: atomic upsert to avoid race between concurrent pushes
    if (options?.key) {
      const now = this.dt.nowISOString();
      const execution = await this.executions.upsert(
        {
          jobName: name,
          key: options.key,
          payload: validated as Record<string, unknown>,
          status,
          priority,
          maxAttempts,
          scheduledAt,
          createdAt: now,
          updatedAt: now,
        },
        { target: ["jobName", "key"], set: {}, now },
      );

      // Fresh insert: both timestamps equal the explicit `now` value.
      // Conflict: updatedAt was bumped by the ON CONFLICT SET clause, so they differ.
      if (
        execution.createdAt === execution.updatedAt &&
        status === "pending" &&
        !this.stopping
      ) {
        this.scheduleProcessing(name, execution.id);
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
    });

    // Dispatch to processing if immediate
    if (status === "pending" && !this.stopping) {
      this.scheduleProcessing(name, execution.id);
    }

    return execution.id;
  }

  public async pushMany(
    name: string,
    items: Array<PushManyItem>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const item of items) {
      const id = await this.push(name, item.payload, {
        key: item.key,
        delay: item.delay,
        priority: item.priority,
        scheduledAt: item.scheduledAt,
      });
      ids.push(id);
    }
    return ids;
  }

  // --- Trigger (manual / cron) ---

  public async trigger(
    name: string,
    context?: JobTriggerContext,
  ): Promise<void> {
    const registration = this.getRegistration(name);
    const opts = registration.options;

    if (context?.payload && opts.schema) {
      // Push-based trigger with payload
      const id = await this.push(name, context.payload, {});
      // Update trigger info
      await this.executions.updateById(id, {
        triggeredBy: context?.triggeredBy,
        triggeredByName: context?.triggeredByName,
      });
      return;
    }

    // Cron-style or manual trigger without payload
    const maxAttempts = (opts.retry?.retries ?? 0) + 1;
    const priority = PRIORITY_MAP[opts.priority ?? "normal"];

    const execution = await this.executions.create({
      jobName: name,
      status: "pending",
      priority,
      maxAttempts,
      triggeredBy: context?.triggeredBy,
      triggeredByName: context?.triggeredByName,
    });

    if (!this.stopping) {
      this.scheduleProcessing(name, execution.id);
    }
  }

  // --- Cancel ---

  public async cancel(
    executionId: string,
    context?: CancelContext,
  ): Promise<void> {
    const execution = await this.executions.findById(executionId);
    if (!execution) {
      throw new AlephaError(`Execution not found: ${executionId}`);
    }

    if (
      execution.status === "completed" ||
      execution.status === "dead" ||
      execution.status === "cancelled"
    ) {
      throw new AlephaError(
        `Cannot cancel execution in '${execution.status}' status`,
      );
    }

    // If running, trigger the AbortSignal
    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
    }

    await this.executions.updateById(executionId, {
      status: "cancelled",
      key: null,
      cancelledBy: context?.cancelledBy,
      cancelledByName: context?.cancelledByName,
      completedAt: this.dt.nowISOString(),
    });
  }

  // --- Execution ---

  protected scheduleProcessing(jobName: string, executionId: string): void {
    this.dispatchQueue.push({ jobName, executionId }).catch((error) => {
      this.log.error(`Failed to dispatch job ${jobName}`, { error });
    });
  }

  protected async processExecution(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    const registration = this.getRegistration(jobName);

    // Claim the execution atomically
    const claimed = await this.claim(executionId);
    if (!claimed) {
      return; // Already claimed by another worker
    }

    const context = this.alepha.context.createContextId();
    this.logs.set(context, []);

    try {
      await this.alepha.context.run(
        async () => {
          // Create AbortController for timeout + cancellation
          const abortController = new AbortController();
          this.abortControllers.set(executionId, abortController);

          // Set up timeout if configured
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const opts = registration.options;
          if (opts.timeout) {
            const ms = this.dt.duration(opts.timeout).as("milliseconds");
            timeoutId = setTimeout(() => abortController.abort(), ms);
          }

          const now = this.dt.now();

          await this.alepha.events.emit("job:begin", {
            name: jobName,
            now,
            executionId,
          });

          try {
            // Build items array
            const execution = await this.executions.findById(executionId);
            const items: Array<JobItem> = [];
            if (execution?.payload) {
              items.push({
                id: executionId,
                payload: execution.payload,
                attempt: execution.attempt,
              });
            }

            // Execute handler
            await opts.handler({
              items,
              now,
              signal: abortController.signal,
            });

            // Success
            await this.executions.updateById(executionId, {
              status: "completed",
              completedAt: this.dt.nowISOString(),
              key: null,
            });

            // Write logs to cold table
            await this.writeLogs(executionId, context);

            await this.alepha.events.emit(
              "job:success",
              { name: jobName, executionId },
              { catch: true },
            );
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));

            // Check if this was a cancellation
            if (abortController.signal.aborted) {
              // Already marked as cancelled by cancel() or it's a timeout
              const currentExecution =
                await this.executions.findById(executionId);
              if (currentExecution?.status !== "cancelled") {
                // Timeout — treat as failure
                await this.handleFailure(executionId, jobName, err, context);
              } else {
                // Was cancelled explicitly — just write logs
                await this.writeLogs(executionId, context);
                await this.alepha.events.emit(
                  "job:cancel",
                  { name: jobName, executionId },
                  { catch: true },
                );
              }
            } else {
              await this.handleFailure(executionId, jobName, err, context);
            }
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
        { context },
      );
    } finally {
      this.logs.delete(context);
    }
  }

  protected async claim(executionId: string): Promise<boolean> {
    const execution = await this.executions.findById(executionId);
    if (!execution) return false;

    try {
      await this.executions.updateOne(
        { id: { eq: executionId }, status: { eq: "pending" } },
        {
          status: "running",
          attempt: execution.attempt + 1,
          startedAt: this.dt.nowISOString(),
          workerId: this.workerId,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  protected async handleFailure(
    executionId: string,
    jobName: string,
    error: Error,
    context: string,
  ): Promise<void> {
    const execution = await this.executions.findById(executionId);
    if (!execution) return;

    const registration = this.getRegistration(jobName);
    const opts = registration.options;
    const retryOpts = opts.retry;

    const canRetry =
      retryOpts &&
      execution.attempt < execution.maxAttempts &&
      (retryOpts.when ? retryOpts.when(error) : true);

    if (canRetry) {
      // Compute next scheduledAt from backoff
      const nextScheduledAt = this.computeBackoff(retryOpts, execution.attempt);

      await this.executions.updateById(executionId, {
        status: "retrying",
        error: error.message,
        scheduledAt: nextScheduledAt,
      });

      await this.writeLogs(executionId, context);

      // Optimistic dispatch: schedule a timeout for the exact backoff delay.
      // The delayed dispatch sweep is the safety net in case of crash.
      const delayMs = Math.max(
        0,
        new Date(nextScheduledAt).getTime() - Date.now(),
      );
      this.dt.createTimeout(
        () => void this.dispatchRetrying(jobName, executionId),
        delayMs,
      );
    } else {
      // Dead — all retries exhausted or predicate returned false
      await this.executions.updateById(executionId, {
        status: "dead",
        error: error.message,
        completedAt: this.dt.nowISOString(),
        key: null,
      });

      await this.writeLogs(executionId, context);
    }

    await this.alepha.events.emit(
      "job:error",
      { name: jobName, error, executionId },
      { catch: true },
    );
  }

  protected computeBackoff(
    retryOpts: JobRetryOptions,
    attempt: number,
  ): string {
    const now = this.dt.now();

    if (!retryOpts.backoff) {
      // Default: 1 second fixed
      return now.add(1, "second").toISOString();
    }

    // Fixed backoff shorthand: [5, "second"]
    if (Array.isArray(retryOpts.backoff)) {
      const delay = this.dt.duration(retryOpts.backoff);
      return now.add(delay).toISOString();
    }

    // Exponential backoff
    const backoff = retryOpts.backoff as JobRetryBackoff;
    const initial = this.dt.duration(backoff.initial).as("milliseconds");
    const factor = backoff.factor ?? 2;
    let delayMs = initial * factor ** (attempt - 1);

    if (backoff.max) {
      const maxMs = this.dt.duration(backoff.max).as("milliseconds");
      delayMs = Math.min(delayMs, maxMs);
    }

    if (backoff.jitter) {
      // Add up to 25% random jitter
      delayMs = delayMs * (0.75 + Math.random() * 0.5);
    }

    return now.add(delayMs, "millisecond").toISOString();
  }

  protected async writeLogs(
    executionId: string,
    context: string,
  ): Promise<void> {
    const entries = this.logs.get(context);
    if (!entries || entries.length === 0) return;

    const maxEntries = this.config.logMaxEntries;
    if (maxEntries === 0) return;

    let logs = entries;
    if (logs.length > maxEntries) {
      logs = logs.slice(0, maxEntries);
      logs.push({
        level: "WARN",
        message: `Log entries truncated at ${maxEntries}`,
        timestamp: Date.now(),
        service: "alepha.jobs",
        module: "JobProvider",
      } as LogEntry);
    }

    try {
      await this.executionLogs.create({
        id: executionId,
        logs,
      });
    } catch {
      // Log write failure is not critical
      this.log.warn(`Failed to write logs for execution ${executionId}`);
    }
  }

  protected async dispatchRetrying(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    if (this.stopping) return;
    try {
      await this.executions.updateOne(
        { id: { eq: executionId }, status: { eq: "retrying" } },
        { status: "pending" },
      );
      this.scheduleProcessing(jobName, executionId);
    } catch {
      // Already transitioned by another worker or sweep
    }
  }

  // --- Internal system sweeps (Section 5 of spec) ---

  /**
   * Recovery Sweep (Section 5.1)
   *
   * Runs every `recovery.interval` (default: 1 minute).
   * - Stale `pending` jobs older than `staleThreshold` → re-dispatch.
   * - Crashed `running` jobs older than `max(job.timeout * 2, recovery.runTimeout)` → mark failed, apply retry policy.
   */
  protected async recoverySweep(): Promise<void> {
    this.log.trace("Starting recovery sweep");
    if (this.stopping) return;
    try {
      const now = this.dt.now();

      // 1. Stale pending jobs
      const staleThreshold = now
        .subtract(this.config.recovery.staleThreshold, "millisecond")
        .toISOString();

      const pendingWhere = this.executions.createQueryWhere();
      pendingWhere.status = { eq: "pending" };
      pendingWhere.createdAt = { lte: staleThreshold };

      const stalePending = await this.executions.findMany({
        where: pendingWhere,
      });

      for (const exec of stalePending) {
        if (!this.jobs.has(exec.jobName)) continue;
        this.log.debug(
          `Recovery sweep: re-dispatching stale pending job ${exec.jobName} (${exec.id})`,
        );
        this.scheduleProcessing(exec.jobName, exec.id);
      }

      // 2. Crashed running jobs
      const runningWhere = this.executions.createQueryWhere();
      runningWhere.status = { eq: "running" };

      const running = await this.executions.findMany({ where: runningWhere });
      const nowMs = now.valueOf();

      for (const exec of running) {
        const registration = this.jobs.get(exec.jobName);
        if (!registration) continue;

        // If this worker owns it and has an active AbortController, skip (still alive)
        if (this.abortControllers.has(exec.id)) continue;

        const opts = registration.options;
        let crashThresholdMs: number;
        if (opts.timeout) {
          crashThresholdMs =
            this.dt.duration(opts.timeout).as("milliseconds") * 2;
        } else {
          crashThresholdMs = this.config.recovery.runTimeout;
        }

        const startedAt = exec.startedAt
          ? new Date(exec.startedAt).getTime()
          : 0;
        if (startedAt > 0 && nowMs - startedAt > crashThresholdMs) {
          this.log.warn(
            `Recovery sweep: marking crashed job ${exec.jobName} (${exec.id}) as failed`,
          );
          const error = new Error(
            "Execution assumed crashed (recovered by sweep)",
          );
          await this.handleFailure(exec.id, exec.jobName, error, "");
        }
      }
    } catch (e) {
      this.log.error("Recovery sweep failed", { error: e });
    }
  }

  /**
   * Delayed Dispatch Sweep (Section 5.2)
   *
   * Runs every `delayed.interval` (default: 30 seconds).
   * Scans for `scheduled` and `retrying` jobs where `scheduledAt <= now`,
   * moves them to `pending`, and dispatches to the queue layer.
   */
  protected async delayedDispatchSweep(): Promise<void> {
    this.log.trace("Starting delayed dispatch sweep");
    if (this.stopping) return;
    try {
      const now = this.dt.nowISOString();

      const where = this.executions.createQueryWhere();
      where.status = { inArray: ["scheduled", "retrying"] };
      where.scheduledAt = { lte: now };

      const ready = await this.executions.findMany({ where });

      for (const exec of ready) {
        if (!this.jobs.has(exec.jobName)) continue;
        await this.executions.updateById(exec.id, { status: "pending" });
        this.scheduleProcessing(exec.jobName, exec.id);
      }
    } catch (e) {
      this.log.error("Delayed dispatch sweep failed", { error: e });
    }
  }

  /**
   * Log Purge (Section 5.3)
   *
   * Runs daily at 03:00 via cron.
   * Deletes completed/dead/cancelled execution records older than `logRetentionDays`.
   */
  protected async logPurge(): Promise<void> {
    if (this.stopping) return;
    try {
      const cutoff = this.dt
        .now()
        .subtract(this.config.logRetentionDays, "day")
        .toISOString();

      const where = this.executions.createQueryWhere();
      where.status = { inArray: ["completed", "dead", "cancelled"] };
      where.completedAt = { lte: cutoff };

      const old = await this.executions.findMany({ where });

      for (const exec of old) {
        try {
          await this.executionLogs.deleteById(exec.id);
        } catch {
          // Log record may not exist
        }
        await this.executions.deleteById(exec.id);
      }

      if (old.length > 0) {
        this.log.info(`Log purge: deleted ${old.length} old execution records`);
      }
    } catch (e) {
      this.log.error("Log purge failed", { error: e });
    }
  }

  // --- Lifecycle hooks ---

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.workerId = crypto.randomUUID().slice(0, 12);

      // Set up log capture listener (once)
      this.alepha.events.on("log", ({ entry }) => {
        const ctx = entry.context;
        if (!ctx) return;
        const entries = this.logs.get(ctx);
        if (!entries) return;
        entries.push(entry);
      });

      // Run initial sweeps to recover from previous crashes
      await this.delayedDispatchSweep();
      await this.recoverySweep();

      // Start periodic sweeps (start = true since DateTimeProvider.onStart already fired)
      this.sweepIntervals.push(
        this.dt.createInterval(
          () => this.recoverySweep(),
          this.config.recovery.interval,
          true,
        ),
      );
      this.sweepIntervals.push(
        this.dt.createInterval(
          () => this.delayedDispatchSweep(),
          this.config.delayed.interval,
          true,
        ),
      );

      // Daily log purge at 03:00
      this.cronProvider.createCronJob(
        "_alepha:jobs:log-purge",
        "0 3 * * *",
        async () => {
          await this.logPurge();
        },
      );
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      this.stopping = true;

      // Clear sweep intervals
      for (const interval of this.sweepIntervals) {
        this.dt.clearInterval(interval);
      }
      this.sweepIntervals.length = 0;

      // Abort any running executions
      for (const controller of this.abortControllers.values()) {
        controller.abort();
      }
    },
  });

  // --- Helpers ---

  protected getRegistration(name: string): JobRegistration {
    const registration = this.jobs.get(name);
    if (!registration) {
      throw new AlephaError(`Job not registered: ${name}`);
    }
    return registration;
  }
}
