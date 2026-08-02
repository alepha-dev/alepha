import {
  $hook,
  $inject,
  $store,
  Alepha,
  AlephaError,
  type Infer,
  type ZType,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import {
  type DateTime,
  DateTimeProvider,
  type DurationLike,
} from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import { $logger, LogBufferProvider, type LogEntry } from "alepha/logger";
import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
} from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import {
  type JobStatus,
  jobExecutionEntity,
} from "../entities/jobExecutionEntity.ts";
import type { JobPrimitiveOptions, JobPriority } from "../primitives/$job.ts";
import { jobConfig } from "../schemas/jobConfigAtom.ts";
import { DirectJobDispatcher } from "./DirectJobDispatcher.ts";
import type { JobDispatcher } from "./JobDispatcher.ts";
import { JobQueueProvider } from "./JobQueueProvider.ts";

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
  /**
   * Owning tenant for this execution. Persisted on the row so tenant-facing
   * views (e.g. the notification admin list) can org-scope it. Plumbed through
   * verbatim — callers in a tenant context pass it explicitly (the resolved
   * tenant), cron/global pushes leave it undefined.
   */
  organizationId?: string;
}

export interface PushManyItem<T extends ZType = ZType> {
  payload: Infer<T>;
  key?: string;
  delay?: DurationLike;
  priority?: JobPriority;
  scheduledAt?: Date;
}

export interface JobTriggerContext<T extends ZType = ZType> {
  payload?: Infer<T>;
  triggeredBy?: string;
  triggeredByName?: string;
}

export interface CancelContext {
  cancelledBy?: string;
  cancelledByName?: string;
}

/**
 * The declared shape of the job (set at registration time).
 *
 * **Important** — this `kind` is the *declared* form. The *effective*
 * runtime mode (cron / queue / direct) is exposed by
 * `JobProvider.effectiveMode(name)` and the `JobRegistration.type` field on
 * the admin schema. Don't conflate the two: a `queue` kind can run as
 * `direct` at runtime when no queue dispatcher is loaded.
 */
interface JobRuntimeRegistration {
  name: string;
  options: JobPrimitiveOptions;
  kind: "cron" | "queue";
}

export type JobEffectiveMode = "cron" | "queue" | "direct";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Coordinates cron and push jobs with a durable outbox table and a single
 * reconciliation sweep. The actual delivery channel (queue / direct) is
 * abstracted behind {@link JobDispatcher}, substituted by DI:
 *
 * - **DirectJobDispatcher** (default, registered by `AlephaApiJobs`) —
 *   runs the handler in-process right after `push()` returns.
 * - **QueueJobDispatcher** (registered by `AlephaApiJobsQueue`) — sends
 *   the executionId through `AlephaQueue` so a pool of workers can pick
 *   it up.
 *
 * Push flow:
 *   push()  → INSERT row (pending) → dispatcher.dispatch(jobName, id)
 *   worker  → claim → UPDATE running → handler → DELETE/UPDATE on success
 *           → UPDATE error / scheduled (retry) on failure
 *
 * Cron flow:
 *   scheduler tick → acquire lock → executeInline (no retry)
 *                                 → enqueue + dispatch (retry declared)
 *
 * Sweep responsibilities (every `sweepCron`):
 *   - re-enqueue pending rows older than `staleThreshold`
 *   - mark crashed running rows as failed and apply retry policy
 *   - move `scheduled` rows with `scheduledAt <= now` to pending + dispatch
 *
 * Trim runs on its own cron (`trimCron`, default hourly):
 *   - per-job history trimmed beyond `keepLastSuccess` / `keepLastError`
 *   - decoupled from sweep because trim cost scales with job count, not
 *     retry latency — running it every sweep is wasted work for most apps.
 */
export class JobProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly cronProvider = $inject(CronProvider);
  protected readonly lockProvider = $inject(LockProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly config = $store(jobConfig);

  /**
   * Resolved at first use (after the container is fully wired) — picks
   * the queue dispatcher when `AlephaApiJobsQueue` was loaded, otherwise
   * the direct dispatcher. Lazy because both dispatchers inject
   * `JobProvider` themselves; resolving them at field-init time would
   * create a circular construction.
   */
  protected dispatcherRef?: JobDispatcher;
  public get dispatcher(): JobDispatcher {
    if (!this.dispatcherRef) {
      this.dispatcherRef = this.alepha.has(JobQueueProvider)
        ? this.alepha.inject(JobQueueProvider)
        : this.alepha.inject(DirectJobDispatcher);
    }
    return this.dispatcherRef;
  }
  protected readonly log = $logger();
  protected readonly executions = $repository(jobExecutionEntity);

  protected readonly jobs = new Map<string, JobRuntimeRegistration>();
  protected readonly inFlight = new Set<Promise<void>>();
  protected readonly abortControllers = new Map<string, AbortController>();
  protected readonly logBuffer = $inject(LogBufferProvider);
  protected stopping = false;

  constructor() {
    // Register the sweep + trim crons eagerly so the wrangler build
    // step (which reads `CronProvider.getCronJobs()` without running
    // any lifecycle hooks) sees them and emits the matching cron
    // triggers into wrangler.jsonc. CronProvider's `start` hook will
    // boot whatever is in `cronJobs` at runtime — registering here
    // (constructor, runs at inject time) is equivalent to registering
    // in `onStart` from CronProvider's POV but visible to build-time
    // introspection.
    this.cronProvider.createCronJob(
      "api:jobs:sweep",
      this.config.sweepCron,
      async () => {
        await this.sweep();
      },
      true,
    );
    this.cronProvider.createCronJob(
      "api:jobs:trim",
      this.config.trimCron,
      async () => {
        if (this.stopping) return;
        try {
          await this.trimRingBuffers();
        } catch (e) {
          this.log.error("Trim failed", { error: e });
        }
      },
      true,
    );
  }

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

    const kind: "cron" | "queue" = options.cron ? "cron" : "queue";

    // Cron jobs keep their last successful run by default, so the admin
    // "Last run" reflects reality — a routine cron success is otherwise
    // unrecorded (only failures are), making every healthy cron look like it
    // "never" ran. Bounded to the latest row (keep.ok=1) to avoid unbounded
    // growth from recurring ticks. Opt out of recording successes entirely
    // with `record: "error"` (recommended for very high-frequency crons).
    if (kind === "cron" && options.record === undefined) {
      options = {
        ...options,
        record: "all",
        keep: { ...options.keep, ok: options.keep?.ok ?? 1 },
      };
    }

    this.jobs.set(name, { name, options, kind });
    this.log.debug(`Registered ${kind} job '${name}'`, {
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

  /**
   * Resolves what *actually* runs at dispatch time. Cron jobs are always
   * "cron"; non-cron jobs delegate to the active `JobDispatcher` (queue
   * vs. direct), which is determined by which modules the app loaded.
   */
  public effectiveMode(name: string): JobEffectiveMode {
    const reg = this.getRegistration(name);
    if (reg.kind === "cron") return "cron";
    return this.dispatcher.kind;
  }

  // --- Cron execution (inline, no queue) --------------------------------------------------------------------------

  protected async runCron(name: string): Promise<void> {
    const registration = this.getRegistration(name);
    if (registration.kind !== "cron") {
      throw new AlephaError(`Job '${name}' is not cron-mode`);
    }
    await this.runCronLocked(registration, {
      triggeredBy: "system",
      triggeredByName: "system (cron)",
    });
  }

  /**
   * Cron-mode runner that respects the per-job distributed lock.
   * Used by both the scheduled tick and manual `trigger()` calls so that an
   * admin-triggered run on one instance can't race a scheduled run on another.
   *
   * **Two paths depending on `retry`:**
   *
   * - **No `retry`** — runs the handler inline. No DB row on success;
   *   error row only on failure. The "next tick" is the implicit retry.
   * - **`retry` declared** — enqueues a synthetic execution row and hands
   *   it to the dispatcher. The handler then runs through the same path
   *   as a queue/direct push (claim, retry-on-fail, sweep recovery). Use
   *   this when a single failed tick must not block work for the whole
   *   `cron` interval (e.g. once-daily jobs).
   */
  protected async runCronLocked(
    registration: JobRuntimeRegistration,
    ctx: { triggeredBy?: string; triggeredByName?: string },
  ): Promise<void> {
    if (this.stopping) return;

    const useLock = registration.options.lock !== false;
    if (useLock) {
      const acquired = await this.acquireCronLock(registration);
      if (!acquired) {
        this.log.debug(
          `Cron '${registration.name}' skipped — another instance holds the lock`,
        );
        return;
      }
    }

    try {
      if (registration.options.retry) {
        await this.enqueueCronExecution(registration, ctx);
        return;
      }

      const executionId = this.crypto.randomUUID();
      const promise = this.executeInline(registration, executionId, {
        payload: undefined,
        attempt: 1,
        triggeredBy: ctx.triggeredBy,
        triggeredByName: ctx.triggeredByName,
      });
      this.inFlight.add(promise);
      try {
        await promise;
      } finally {
        this.inFlight.delete(promise);
      }
    } finally {
      if (useLock) {
        await this.releaseCronLock(registration);
      }
    }
  }

  /**
   * Materialize a cron tick into the outbox so it goes through the normal
   * retry/sweep path. Used when the user opts into `retry` on a cron job —
   * a transient failure no longer means "wait for the next cron tick", it
   * means "the sweep will retry within `sweepCron`".
   */
  protected async enqueueCronExecution(
    registration: JobRuntimeRegistration,
    ctx: { triggeredBy?: string; triggeredByName?: string },
  ): Promise<void> {
    const opts = registration.options;
    const maxAttempts = (opts.retry?.retries ?? 0) + 1;
    const execution = await this.executions.create({
      jobName: registration.name,
      payload: undefined,
      status: "pending",
      priority: PRIORITY_MAP[opts.priority ?? "normal"],
      maxAttempts,
      triggeredBy: ctx.triggeredBy,
      triggeredByName: ctx.triggeredByName,
    });
    await this.dispatch(registration.name, execution.id);
  }

  /**
   * Acquire a per-job NX lock keyed by `cron-job:<name>` so that a single
   * tick across all replicas runs exactly one execution. Auto-expires after
   * `2 * timeout` (or 5 minutes if no per-job timeout) so a crashed worker
   * cannot permanently block the cron from firing.
   *
   * **Caveat — same-process double-fire is not prevented.** The lock value
   * is a per-process holder id, so two concurrent ticks on the same process
   * (e.g. a scheduled tick overlapping an admin `trigger()` call) will both
   * see "we own it". This is acceptable for the multi-replica use case the
   * lock targets; a process that overlaps its own cron handler should set a
   * smaller `timeout` or use idempotent handler logic. A future fix can add
   * a per-process Set guard before reaching the LockProvider.
   */
  protected async acquireCronLock(
    registration: JobRuntimeRegistration,
  ): Promise<boolean> {
    const lockKey = this.cronLockKey(registration.name);
    const ttlMs = registration.options.timeout
      ? this.dt.duration(registration.options.timeout).as("milliseconds") * 2
      : 5 * 60 * 1000;
    const value = `${this.lockHolderId},${this.dt.nowISOString()}`;
    try {
      const stored = await this.lockProvider.set(lockKey, value, true, ttlMs);
      const [holderId] = stored.split(",");
      return holderId === this.lockHolderId;
    } catch (e) {
      this.log.warn(`Cron lock acquire failed for '${registration.name}'`, e);
      return true; // Fail-open: better to risk a duplicate than to silently miss a tick.
    }
  }

  /**
   * Update only when the row is still in one of the expected statuses.
   * Logs and returns silently when the guard rejects — this happens when a
   * concurrent operation (most often `cancel()`) has already moved the row
   * into a terminal state. We must not overwrite that.
   */
  protected async guardedUpdate(
    executionId: string,
    expectedStatuses: JobStatus[],
    patch: Parameters<typeof this.executions.updateById>[1],
    label: string,
  ): Promise<void> {
    try {
      await this.executions.updateOne(
        { id: { eq: executionId }, status: { inArray: expectedStatuses } },
        patch,
      );
    } catch (e) {
      if (e instanceof DbEntityNotFoundError) {
        this.log.debug(
          `${label}: row ${executionId} not in expected status — skipping write`,
        );
        return;
      }
      throw e;
    }
  }

  protected async releaseCronLock(
    registration: JobRuntimeRegistration,
  ): Promise<void> {
    try {
      await this.lockProvider.del(this.cronLockKey(registration.name));
    } catch (e) {
      this.log.debug(
        `Cron lock release failed for '${registration.name}' (will expire by TTL)`,
        e,
      );
    }
  }

  protected cronLockKey(jobName: string): string {
    return `alepha.api.jobs.cron:${jobName}`;
  }

  /**
   * Stable per-process id used as the lock value — survives multiple ticks.
   * Lazy so that Cloudflare Workers (which forbid random in global scope)
   * stay happy.
   */
  protected lockHolderIdValue?: string;
  protected get lockHolderId(): string {
    if (!this.lockHolderIdValue) {
      this.lockHolderIdValue = this.crypto.randomUUID();
    }
    return this.lockHolderIdValue;
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

    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      const ms = this.dt.duration(opts.timeout).as("milliseconds");
      timeoutId = setTimeout(() => abortController.abort(), ms);
    }

    const startedAt = this.dt.now();

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
          const err = error instanceof Error ? error : new Error(String(error));
          if (record !== "none") {
            await this.writeTerminalRow(executionId, name, "error", {
              payload: ctx.payload,
              attempt: ctx.attempt,
              startedAt,
              error: err,
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
      { context: contextId, ...this.logBuffer.seed(this.config.logMaxEntries) },
    );
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
      triggeredBy?: string;
      triggeredByName?: string;
    },
  ): Promise<void> {
    try {
      // Called from inside the execution's context, so the buffer of the run
      // that just finished is the ambient one.
      const logs = status === "error" ? this.logBuffer.snapshot() : undefined;
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
    if (registration.kind !== "queue") {
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
      const { id: executionId, created } = await this.createKeyedExecution({
        jobName: name,
        key: options.key,
        payload: validated as Record<string, unknown>,
        status,
        priority,
        maxAttempts,
        scheduledAt,
        triggeredBy: options.triggeredBy,
        triggeredByName: options.triggeredByName,
        organizationId: options.organizationId,
      });
      if (!created) {
        // Lost the race to a concurrent same-key push — the winner dispatches.
        return executionId;
      }
      if (status === "pending") {
        await this.dispatch(name, executionId);
      } else if (status === "scheduled" && scheduledAt) {
        this.scheduleOptimisticDispatch(name, executionId, scheduledAt);
      }
      return executionId;
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
      organizationId: options?.organizationId,
    });

    if (status === "pending") {
      await this.dispatch(name, execution.id);
    } else if (status === "scheduled" && scheduledAt) {
      this.scheduleOptimisticDispatch(name, execution.id, scheduledAt);
    }
    return execution.id;
  }

  /**
   * How long a `running` row may go without a lease renewal before the
   * sweep assumes the instance running it crashed. Shared by the sweep's
   * crash detection and the heartbeat cadence so the two can't drift.
   */
  protected crashThresholdMs(registration: JobRuntimeRegistration): number {
    return registration.options.timeout
      ? this.dt.duration(registration.options.timeout).as("milliseconds") * 2
      : this.config.runTimeout;
  }

  /**
   * While a handler runs, keep the row's `updatedAt` fresh so another
   * instance's sweep can tell a long-running job from a crashed one — the
   * sweep treats `max(startedAt, updatedAt)` as the lease. Self-stops when
   * the row leaves `running` (finished, cancelled, swept elsewhere).
   */
  protected startLeaseHeartbeat(
    executionId: string,
    registration: JobRuntimeRegistration,
  ): ReturnType<typeof setInterval> {
    const intervalMs = Math.max(
      250,
      Math.floor(this.crashThresholdMs(registration) / 3),
    );
    const timer = setInterval(() => {
      void (async () => {
        try {
          await this.executions.updateOne(
            { id: { eq: executionId }, status: { eq: "running" } },
            { status: "running" },
          );
        } catch (error) {
          if (this.shouldStopHeartbeat(error)) {
            clearInterval(timer);
            return;
          }
          this.log.warn(
            `Lease heartbeat failed for ${executionId}, will retry next tick`,
            { error },
          );
        }
      })();
    }, intervalMs);
    return timer;
  }

  /**
   * Whether a failed lease renewal means the heartbeat should stop.
   *
   * Only when the row is gone or no longer `running` (cancelled, completed
   * elsewhere) — there is nothing left to renew. A transient DB error must
   * NOT stop it: the handler keeps running, so once `crashThresholdMs`
   * elapses another instance's sweep marks the lease crashed and schedules a
   * retry — a duplicate, concurrent execution of the same job.
   */
  protected shouldStopHeartbeat(error: unknown): boolean {
    return error instanceof DbEntityNotFoundError;
  }

  /**
   * Insert a keyed execution row, resolving the dedup pre-check/insert
   * race: a concurrent same-key push can land between the read and this
   * insert, so a unique violation on (jobName, key) is settled by
   * returning the winner's row instead of throwing.
   */
  protected async createKeyedExecution(fields: {
    jobName: string;
    key: string;
    payload?: Record<string, unknown>;
    status: JobStatus;
    priority: number;
    maxAttempts: number;
    scheduledAt?: string;
    triggeredBy?: string;
    triggeredByName?: string;
    organizationId?: string;
  }): Promise<{ id: string; created: boolean }> {
    try {
      const execution = await this.executions.create(fields);
      return { id: execution.id, created: true };
    } catch (e) {
      if (e instanceof DbConflictError) {
        const winner = await this.executions.findMany({
          where: { jobName: { eq: fields.jobName }, key: { eq: fields.key } },
          limit: 1,
        });
        if (winner.length > 0) {
          return { id: winner[0].id, created: false };
        }
      }
      throw e;
    }
  }

  /**
   * Ceiling for the optimistic local timer. Past one day the sweep is the
   * delivery mechanism anyway, and a 32-bit `setTimeout` overflows at
   * ~24.85 days — an unclamped timer would fire immediately and run the
   * job weeks early.
   */
  protected readonly maxOptimisticDelayMs = 24 * 60 * 60 * 1000;

  /**
   * Fire a local setTimeout so delayed/retrying rows dispatch as close to
   * `scheduledAt` as possible, rather than waiting for the next sweep tick.
   * No-op on stateless runtimes where timers won't survive, and for delays
   * beyond `maxOptimisticDelayMs` (the sweep handles both).
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
    if (delayMs > this.maxOptimisticDelayMs) {
      return;
    }
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
    if (registration.kind !== "queue") {
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
        keyed.push({ ...item, payload: validated as Infer<ZType> });
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
      // Collect pending rows so we hand them to the dispatcher in a single
      // batch — the queue dispatcher can fan them out in one network call.
      const toDispatch: Array<{ jobName: string; executionId: string }> = [];
      for (const exec of created) {
        ids.push(exec.id);
        if (exec.status === "pending" && !this.stopping) {
          toDispatch.push({ jobName: name, executionId: exec.id });
        } else if (
          exec.status === "scheduled" &&
          exec.scheduledAt &&
          !this.stopping
        ) {
          this.scheduleOptimisticDispatch(name, exec.id, exec.scheduledAt);
        }
      }
      if (toDispatch.length > 0) {
        await this.dispatchMany(toDispatch);
      }
    }

    this.log.debug(`pushMany '${name}': ${ids.length} jobs created`, {
      bulk: bulk.length,
      keyed: keyed.length,
    });

    return ids;
  }

  /**
   * Hand a single execution to the active `JobDispatcher`. Whether that
   * results in a queue send or in-process execution depends on which
   * dispatcher is wired (see {@link JobDispatcher}).
   */
  protected async dispatch(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    if (this.stopping) return;
    await this.dispatcher.dispatch(jobName, executionId);
  }

  /**
   * Batched variant. Used by `pushMany` so a backing queue can do a single
   * batch network call (e.g. Cloudflare Queues `sendBatch`).
   */
  protected async dispatchMany(
    items: Array<{ jobName: string; executionId: string }>,
  ): Promise<void> {
    if (this.stopping || items.length === 0) return;
    await this.dispatcher.dispatchMany(items);
  }

  // --- Manual trigger (admin / CLI) ------------------------------------------------------------------------------

  public async trigger(
    name: string,
    context?: JobTriggerContext,
  ): Promise<void> {
    const registration = this.getRegistration(name);

    if (registration.kind === "cron") {
      await this.runCronLocked(registration, {
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

    // Status-guarded: the execution may complete between our read above and
    // this write — never stamp `cancelled` over a terminal row. Claim the
    // status BEFORE aborting: the abort makes the running handler throw, and
    // its failure path would otherwise write `error` first, making this
    // legitimate cancellation lose the race (flaky on slow machines).
    try {
      await this.executions.updateOne(
        {
          id: { eq: executionId },
          status: { inArray: ["pending", "running", "scheduled"] },
        },
        {
          status: "cancelled",
          key: null,
          cancelledBy: context?.cancelledBy,
          cancelledByName: context?.cancelledByName,
          completedAt: this.dt.nowISOString(),
        },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        const current = await this.executions.findById(executionId);
        throw new AlephaError(
          `Cannot cancel execution in '${current?.status ?? "deleted"}' status`,
        );
      }
      throw error;
    }

    const controller = this.abortControllers.get(executionId);
    if (controller) controller.abort();

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
    // Both `queue` and cron-with-retry execute through the outbox path —
    // the DB-level `claim()` is the actual concurrency guard.
    if (registration.kind !== "queue" && !registration.options.retry) {
      this.log.warn(
        `Job '${jobName}' has no outbox path (no schema and no retry) — skipping`,
        { executionId },
      );
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

    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      const ms = this.dt.duration(opts.timeout).as("milliseconds");
      timeoutId = setTimeout(() => abortController.abort(), ms);
    }
    const leaseTimer = this.startLeaseHeartbeat(executionId, registration);

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

            // Success: either DELETE (no retention configured, or
            // record=error) or UPDATE to 'ok'.
            // Guarded on 'running' — a cancellation that landed while the
            // handler was finishing must not be stomped to 'ok' or erased.
            //
            // The two `0`s mean opposite things, by documented design:
            //   - per-job `keep.ok: 0`  → "keep forever, never trim"
            //   - global `keepLastSuccess: 0` → "delete on success"
            // So an explicit per-job value ALWAYS retains the row (0 =
            // forever, >0 = ring buffer trimmed later); only when the job is
            // silent does the global's delete-on-success apply. Reading just
            // the global here destroyed the audit trail of jobs that
            // declared `record: "all", keep: { ok: 0 }` — notifications
            // being the in-tree example.
            const perJobKeepOk = opts.keep?.ok;
            const keepSuccess =
              record === "all" &&
              (perJobKeepOk !== undefined
                ? true
                : this.config.keepLastSuccess > 0);
            if (keepSuccess) {
              await this.guardedUpdate(
                executionId,
                ["running"],
                {
                  status: "ok",
                  completedAt: this.dt.nowISOString(),
                  key: null,
                },
                "success",
              );
            } else {
              await this.executions.deleteMany({
                id: { eq: executionId },
                status: { eq: "running" },
              });
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
              this.logBuffer.snapshot(),
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
        {
          context: contextId,
          ...this.logBuffer.seed(this.config.logMaxEntries),
        },
      );
    } finally {
      clearInterval(leaseTimer);
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
    /**
     * Breadcrumbs of the run that failed. Passed in rather than read from the
     * ambient context: the sweep recovers crashed executions from *outside*
     * any run, and must not staple whatever context it happens to sit in
     * (a request, another job) onto the row it is repairing.
     */
    logs?: LogEntry[],
  ): Promise<void> {
    const jobName = registration.name;
    const opts = registration.options;
    const retry = opts.retry;
    const maxAttempts = (retry?.retries ?? 0) + 1;

    // `retries: 2` means "1 initial + 2 retries = 3 total attempts". Retry
    // while we have not yet *executed* the maxAttempts'th attempt — i.e.
    // currentAttempt (the one that just failed) is strictly less than
    // maxAttempts. The off-by-one fix: previously this was
    // `currentAttempt + 1 < maxAttempts`, which only ran 2 attempts for
    // `retries: 2`.
    const canRetry =
      retry &&
      currentAttempt < maxAttempts &&
      (retry.when ? retry.when(error) : true);

    if (canRetry) {
      // Retries are sweep-driven: write the row as `scheduled` with
      // `scheduledAt = now`. The next sweep tick (every `sweepCron`,
      // default 15 minutes) re-dispatches it. This means the first retry
      // can land anywhere from a few seconds to ~15 minutes later — the
      // exact moment depends on when the next sweep tick fires.
      //
      // We deliberately do NOT use exponential backoff or a local timer.
      // - Exponential backoff was platform-dependent (precise on Node
      //   via setTimeout, but degraded to "next sweep" on Cloudflare
      //   Workers where timers don't survive invocations). The behavior
      //   is now identical everywhere.
      // - Sweep-only retry keeps the retry path observable from a single
      //   place (the DB) and removes a class of races between the timer
      //   and the sweep.
      const nextScheduledAt = this.dt.nowISOString();
      this.log.info(
        `Job '${jobName}' failed, scheduling retry ${currentAttempt + 1}/${maxAttempts} (sweep will pick up)`,
        { executionId, error: error.message },
      );
      // Guard with `status: running` so a concurrent cancel that has already
      // flipped the row to 'cancelled' is not overwritten by the retry write.
      await this.guardedUpdate(
        executionId,
        ["running"],
        {
          status: "scheduled",
          error: error.message,
          scheduledAt: nextScheduledAt,
          logs,
        },
        "retry-after-failure",
      );
    } else {
      this.log.info(
        `Job '${jobName}' dead after ${currentAttempt} attempt(s)`,
        { executionId, error: error.message },
      );
      await this.guardedUpdate(
        executionId,
        ["running"],
        {
          status: "error",
          error: error.message,
          completedAt: this.dt.nowISOString(),
          key: null,
          logs,
        },
        "terminal-failure",
      );
    }

    await this.alepha.events.emit(
      "job:error",
      { name: jobName, error, executionId },
      { catch: true },
    );
  }

  // --- Sweep ----------------------------------------------------------------------------------------------------

  protected async sweep(): Promise<void> {
    if (this.stopping) return;
    this.log.trace("Starting job sweep");
    const now = this.dt.now();
    const nowIso = now.toISOString();

    // Each phase is contained independently: one failing phase (or one bad
    // row inside it) must not skip the others until the next tick, which is
    // 15 minutes away by default.
    await this.sweepPhase("promote-due", () => this.sweepDue(nowIso));
    await this.sweepPhase("redispatch-stale", () => this.sweepStale(now));
    await this.sweepPhase("recover-crashed", () => this.sweepCrashed(now));
  }

  protected async sweepPhase(
    label: string,
    phase: () => Promise<void>,
  ): Promise<void> {
    try {
      await phase();
    } catch (error) {
      this.log.error(`Sweep phase '${label}' failed`, { error });
    }
  }

  /** Phase 1: due `scheduled` rows → pending + dispatch. */
  protected async sweepDue(nowIso: string): Promise<void> {
    const dueWhere = this.executions.createQueryWhere();
    dueWhere.status = { eq: "scheduled" };
    dueWhere.scheduledAt = { lte: nowIso };
    const due = await this.executions.findMany({
      where: dueWhere,
      orderBy: { column: "priority", direction: "asc" },
    });
    for (const exec of due) {
      if (!this.jobs.has(exec.jobName)) continue;
      await this.promoteDue(exec);
    }
  }

  /** Phase 2: stale `pending` rows → re-dispatch. */
  protected async sweepStale(now: DateTime): Promise<void> {
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
      await this.dispatchSafe(exec.jobName, exec.id);
    }
  }

  /** Phase 3: crashed `running` rows → mark failed + apply retry. */
  protected async sweepCrashed(now: DateTime): Promise<void> {
    const runningWhere = this.executions.createQueryWhere();
    runningWhere.status = { eq: "running" };
    const running = await this.executions.findMany({ where: runningWhere });
    const nowMs = now.valueOf();
    for (const exec of running) {
      const reg = this.jobs.get(exec.jobName);
      if (!reg) continue;
      if (this.abortControllers.has(exec.id)) continue; // still alive locally
      const crashThresholdMs = this.crashThresholdMs(reg);
      const startedAtMs = exec.startedAt
        ? new Date(exec.startedAt).getTime()
        : 0;
      // The lease is whichever is fresher: the claim (startedAt) or the
      // last heartbeat (updatedAt). A legitimately long-running job on
      // another instance keeps renewing; only a stale lease is a crash.
      const heartbeatMs = exec.updatedAt
        ? new Date(exec.updatedAt).getTime()
        : 0;
      const lastAliveMs = Math.max(startedAtMs, heartbeatMs);
      if (lastAliveMs > 0 && nowMs - lastAliveMs > crashThresholdMs) {
        this.log.warn(
          `Sweep: marking crashed ${exec.jobName} (${exec.id}) as failed`,
        );
        const err = new Error("Execution assumed crashed (recovered by sweep)");
        // Per-row containment: one unrecoverable row must not strand the
        // remaining crashed executions until the next tick.
        try {
          await this.handleFailure(exec.id, reg, exec.attempt, err);
        } catch (error) {
          this.log.error(
            `Sweep failed to recover crashed execution ${exec.id}`,
            { error },
          );
        }
      }
    }
  }

  /**
   * Sweep phase 1: promote a due `scheduled` row to `pending` and dispatch.
   * Status-guarded like `dispatchScheduled` — a concurrent `cancel()` between
   * the sweep's read and this write must win, not be resurrected. A failure
   * on one row must not abort the rest of the sweep tick.
   */
  protected async promoteDue(exec: {
    id: string;
    jobName: string;
  }): Promise<void> {
    try {
      await this.executions.updateOne(
        { id: { eq: exec.id }, status: { eq: "scheduled" } },
        { status: "pending" },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        this.log.trace(
          `Sweep: skipping ${exec.jobName} (${exec.id}) — no longer scheduled`,
        );
        return;
      }
      this.log.warn(`Sweep failed to promote ${exec.jobName} (${exec.id})`, {
        error,
      });
      return;
    }
    await this.dispatchSafe(exec.jobName, exec.id);
  }

  protected async dispatchSafe(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.dispatch(jobName, executionId);
    } catch (e) {
      this.log.warn(`Sweep failed to dispatch ${jobName} (${executionId})`, e);
    }
  }

  /**
   * Move a row from `scheduled` → `pending` and dispatch it.
   * Used by the optimistic retry/delay timer. If the sweep has already moved
   * the row, or another worker has claimed it, the UPDATE guard fails silently.
   * The `scheduledAt <= now` condition keeps a stray early timer (clock skew,
   * timer overflow) from promoting a row ahead of schedule.
   */
  protected async dispatchScheduled(
    jobName: string,
    executionId: string,
  ): Promise<void> {
    if (this.stopping) return;
    try {
      await this.executions.updateOne(
        {
          id: { eq: executionId },
          status: { eq: "scheduled" },
          scheduledAt: { lte: this.dt.nowISOString() },
        },
        { status: "pending" },
      );
      await this.dispatchSafe(jobName, executionId);
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
        orderBy: { column: "createdAt", direction: "desc" },
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
      // Summarize effective modes once at start so operators can see at a
      // glance what each job will do. No validation is needed here: queue
      // jobs gracefully fall back to direct mode when AlephaApiJobsQueue
      // isn't loaded.
      const modes: Record<JobEffectiveMode, number> = {
        cron: 0,
        queue: 0,
        direct: 0,
      };
      const perJob: Record<string, JobEffectiveMode> = {};
      for (const [name] of this.jobs) {
        const m = this.effectiveMode(name);
        modes[m]++;
        perJob[name] = m;
      }
      this.log.info(`Job system OK`, {
        modes,
        jobs: this.jobs.size,
        perJob,
      });

      if (!this.alepha.isServerless()) {
        await this.sweep();
      }

      // Sweep + trim cron registrations live in the constructor — see
      // the note there. CronProvider's `start` hook (which runs before
      // ours via DI order) has already booted them by the time we get
      // here.
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
