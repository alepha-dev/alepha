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
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import { $logger, LogBufferProvider } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";
import {
  type WorkflowExecutionEntity,
  type WorkflowStatus,
  workflowExecutions,
} from "../entities/workflowExecutions.ts";
import {
  type WorkflowStepExecutionEntity,
  workflowStepExecutions,
} from "../entities/workflowStepExecutions.ts";
import { workflowStepLogs } from "../entities/workflowStepLogs.ts";
import type {
  WorkflowPrimitive,
  WorkflowPrimitiveOptions,
  WorkflowRetryBackoff,
  WorkflowRetryOptions,
  WorkflowStartOptions,
  WorkflowStep,
} from "../primitives/$workflow.ts";
import { workflowConfig } from "../schemas/workflowConfigAtom.ts";

// -----------------------------------------------------------------------------------------------------------------

interface WorkflowRuntimeRegistration {
  name: string;
  options: WorkflowPrimitiveOptions;
}

export interface CancelOptions {
  compensate?: boolean;
  cancelledBy?: string;
  cancelledByName?: string;
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * The workflow engine: persists executions and step state, dispatches
 * steps (inline or through the `$job` queue via {@link WorkflowJobs}),
 * retries with backoff, compensates in reverse order on failure, and
 * recovers crashed or timed-out executions via sweeps.
 */
export class WorkflowProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly lockProvider = $inject(LockProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly logBuffer = $inject(LogBufferProvider);
  protected readonly config = $store(workflowConfig);
  protected readonly log = $logger();
  protected readonly executions = $repository(workflowExecutions);
  protected readonly stepExecutions = $repository(workflowStepExecutions);
  protected readonly stepLogs = $repository(workflowStepLogs);

  protected readonly priorityMap: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  protected readonly workflows = new Map<string, WorkflowRuntimeRegistration>();
  protected readonly pausedWorkflows = new Set<string>();
  protected readonly inFlight = new Set<Promise<void>>();
  protected readonly abortControllers = new Map<string, AbortController>();
  protected stopping = false;

  /**
   * When set, step dispatches go through the `$job` queue.
   * Set by WorkflowJobs on start. `delayMs` defers delivery (durable —
   * it becomes a scheduled outbox row, not just a timer).
   */
  public stepDispatch:
    | ((
        workflowId: string,
        stepName: string,
        priority: number,
        delayMs?: number,
      ) => Promise<void>)
    | null = null;

  // --- Registration -----------------------------------------------------------------------------------------------

  public register(primitive: WorkflowPrimitive<any>): void {
    if (this.workflows.has(primitive.name)) {
      throw new AlephaError(`Workflow already registered: ${primitive.name}`);
    }
    this.workflows.set(primitive.name, {
      name: primitive.name,
      options: primitive.options,
    });
    this.log.debug(`Registered workflow '${primitive.name}'`, {
      steps: primitive.options.steps.length,
    });
  }

  public getRegisteredWorkflows(): Map<string, WorkflowRuntimeRegistration> {
    return this.workflows;
  }

  // --- Start ------------------------------------------------------------------------------------------------------

  public async start(
    workflowName: string,
    payload: unknown,
    options?: WorkflowStartOptions,
  ): Promise<string> {
    const registration = this.getRegistration(workflowName);
    const opts = registration.options;

    const validated = this.alepha.codec.validate(opts.schema, payload);

    const priority =
      this.priorityMap[options?.priority ?? opts.priority ?? "normal"];
    const status: WorkflowStatus = options?.delay ? "pending" : "running";

    const delayMs = options?.delay
      ? this.dt.duration(options.delay).as("milliseconds")
      : 0;
    const scheduledAt = this.dt.now().add(delayMs, "millisecond").toISOString();

    // The first step's own `delay` composes with the start delay: a
    // step-level delay counts from the previous step's completion, which
    // for step 0 is the (possibly deferred) start. Later steps are
    // stamped by advance(); step 0 never passes through advance(), so it
    // must be stamped here or its delay would be silently skipped.
    const firstStepDelayMs = opts.steps[0]?.delay
      ? this.dt.duration(opts.steps[0].delay).as("milliseconds")
      : 0;
    const firstDispatchDelayMs = delayMs + firstStepDelayMs;
    const firstStepScheduledAt =
      firstDispatchDelayMs > 0
        ? this.dt.now().add(firstDispatchDelayMs, "millisecond").toISOString()
        : undefined;

    let deadlineAt: string | undefined;
    if (opts.timeout) {
      deadlineAt = this.dt
        .now()
        .add(delayMs, "millisecond")
        .add(this.dt.duration(opts.timeout))
        .toISOString();
    }

    // Keyed deduplication — the partial unique index on (workflowName, key)
    // over non-terminal statuses backs this read-then-create check, and a
    // conflict on create is resolved by returning the winner's row.
    if (options?.key) {
      const existing = await this.executions.findMany({
        where: {
          workflowName: { eq: workflowName },
          key: { eq: options.key },
          status: { inArray: ["pending", "running", "compensating"] },
        },
        limit: 1,
      });
      if (existing.length > 0) {
        return existing[0].id;
      }
    }

    let execution: WorkflowExecutionEntity;
    try {
      execution = await this.executions.create({
        workflowName,
        payload: validated as Record<string, unknown>,
        context: this.captureContext(opts),
        status,
        priority,
        deadlineAt,
        scheduledAt,
        key: options?.key,
        triggeredBy: options?.triggeredBy,
        triggeredByName: options?.triggeredByName,
        tags: options?.tags ?? opts.tags,
        startedAt: status === "running" ? this.dt.nowISOString() : undefined,
      });
    } catch (e) {
      // A concurrent same-key start can land between the dedup pre-check
      // and this insert; the partial unique index settles the race —
      // return the winner instead of throwing.
      if (e instanceof DbConflictError && options?.key) {
        const winner = await this.executions.findMany({
          where: {
            workflowName: { eq: workflowName },
            key: { eq: options.key },
            status: { inArray: ["pending", "running", "compensating"] },
          },
          limit: 1,
        });
        if (winner.length > 0) {
          return winner[0].id;
        }
      }
      throw e;
    }

    for (let i = 0; i < opts.steps.length; i++) {
      const step = opts.steps[i];
      await this.stepExecutions.create({
        workflowExecutionId: execution.id,
        stepName: step.name,
        stepIndex: i,
        status: "pending",
        maxAttempts: (step.retry?.retries ?? 0) + 1,
        // A delayed start and/or a first-step `delay` pin step 0's
        // not-before time; later steps' own `delay` is stamped by
        // advance() when they become due.
        scheduledAt: i === 0 ? firstStepScheduledAt : undefined,
      });
    }

    this.log.info(`Started workflow '${workflowName}'`, {
      workflowId: execution.id,
      steps: opts.steps.length,
    });

    await this.alepha.events.emit(
      "workflow:started",
      {
        workflowName,
        workflowId: execution.id,
      },
      { catch: true },
    );

    if (!this.stopping) {
      const firstStep = opts.steps[0];
      if (firstStep) {
        // Delayed starts dispatch through the outbox with the delay —
        // the scheduled row survives a crash; the sweep is the fallback.
        await this.dispatchStep(
          execution.id,
          firstStep.name,
          priority,
          firstDispatchDelayMs,
        );
      } else {
        await this.executions.updateById(execution.id, {
          status: "completed",
          completedAt: this.dt.nowISOString(),
        });
      }
    }

    return execution.id;
  }

  // --- Process step -----------------------------------------------------------------------------------------------

  public async processStep(
    workflowId: string,
    stepName: string,
  ): Promise<void> {
    return this.tracked(this.processStepInner(workflowId, stepName));
  }

  /**
   * Register a unit of work in `inFlight` so the stop hook drains it
   * before the database goes away. Sweeps go through this too: a sweep
   * mid-loop at shutdown otherwise races the ORM's teardown — on the
   * Postgres test provider that race is a literal deadlock between the
   * sweep's SELECT and `DROP SCHEMA ... CASCADE`.
   */
  protected async tracked(promise: Promise<void>): Promise<void> {
    this.inFlight.add(promise);
    try {
      await promise;
    } finally {
      this.inFlight.delete(promise);
    }
  }

  protected async processStepInner(
    workflowId: string,
    stepName: string,
  ): Promise<void> {
    // Per-workflow lock: two dispatches for the same execution must not
    // interleave (a retry timer racing a sweep, or two queue deliveries).
    const lockKey = `workflow:${workflowId}`;
    const lockValue = `${this.crypto.randomUUID()},${this.dt.nowISOString()}`;
    const lockResult = await this.lockProvider.set(
      lockKey,
      lockValue,
      true,
      600_000,
    );
    if (lockResult.split(",")[0] !== lockValue.split(",")[0]) {
      this.log.debug(
        `Workflow ${workflowId} locked by another worker, skipping`,
      );
      return;
    }

    try {
      const workflow = await this.executions.findById(workflowId);
      if (!workflow) return;

      if (workflow.status !== "running" && workflow.status !== "pending") {
        return;
      }

      const registration = this.getRegistration(workflow.workflowName);
      const stepDef = registration.options.steps.find(
        (s) => s.name === stepName,
      );
      if (!stepDef) return;

      const stepExec = await this.findStepExecution(workflowId, stepName);
      if (!stepExec) return;

      if (stepExec.status !== "pending") return;

      // Early arrival (an optimistic timer or a duplicate dispatch racing
      // a scheduled delay/retry): put it back with the remaining delay.
      if (stepExec.scheduledAt) {
        const remainingMs =
          new Date(stepExec.scheduledAt).getTime() - this.dt.nowMillis();
        if (remainingMs > 0) {
          await this.dispatchStep(
            workflowId,
            stepName,
            workflow.priority,
            remainingMs,
          );
          return;
        }
      }

      if (workflow.status === "pending") {
        await this.executions.updateById(workflowId, {
          status: "running",
          startedAt: this.dt.nowISOString(),
        });
      }

      if (stepDef.when) {
        const results = await this.assembleResults(workflowId);
        const shouldRun = await this.alepha.context.run(async () => {
          this.restoreContext(workflow);
          return stepDef.when?.({
            payload: workflow.payload as Infer<ZType>,
            results,
          });
        });
        if (!shouldRun) {
          await this.stepExecutions.updateById(stepExec.id, {
            status: "skipped",
            completedAt: this.dt.nowISOString(),
          });
          await this.alepha.events.emit(
            "workflow:step:skipped",
            {
              workflowName: workflow.workflowName,
              workflowId,
              stepName,
            },
            { catch: true },
          );
          await this.advance(workflowId);
          return;
        }
      }

      await this.executeHandlerStep(workflow, stepExec, stepDef);
    } finally {
      await this.lockProvider.del(lockKey);
    }
  }

  protected async executeHandlerStep(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: WorkflowStep,
  ): Promise<void> {
    const workflowId = workflow.id;
    const stepName = stepExec.stepName;

    await this.stepExecutions.updateById(stepExec.id, {
      status: "running",
      attempt: stepExec.attempt + 1,
      startedAt: this.dt.nowISOString(),
    });

    await this.executions.updateById(workflowId, {
      currentStep: stepName,
    });

    await this.alepha.events.emit(
      "workflow:step:begin",
      {
        workflowName: workflow.workflowName,
        workflowId,
        stepName,
      },
      { catch: true },
    );

    const abortController = new AbortController();
    const abortKey = `${workflowId}:${stepName}`;
    this.abortControllers.set(abortKey, abortController);

    const timeoutMs = stepDef.timeout
      ? this.dt.duration(stepDef.timeout).as("milliseconds")
      : this.config.defaultStepTimeout;
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const context = this.alepha.context.createContextId();

    try {
      await this.alepha.context.run(
        async () => {
          try {
            this.restoreContext(workflow);
            const results = await this.assembleResults(workflowId);

            const handlerResult = await stepDef.handler({
              payload: workflow.payload as Infer<ZType>,
              results,
              context: {
                workflowId,
                executionId: stepExec.id,
                stepName,
                attempt: stepExec.attempt + 1,
                iteration: stepExec.iteration ?? 0,
              },
              signal: abortController.signal,
            });

            if (
              stepDef.repeat &&
              typeof handlerResult === "object" &&
              handlerResult !== null &&
              (handlerResult as { repeat?: boolean }).repeat === true
            ) {
              const nextIteration = (stepExec.iteration ?? 0) + 1;
              if (
                stepDef.repeat.limit != null &&
                nextIteration >= stepDef.repeat.limit
              ) {
                // The step has already run `limit` times. Spend the retry
                // budget so handleStepFailure treats this as permanent —
                // retrying would only re-run the handler into the same
                // verdict.
                stepExec.attempt = stepExec.maxAttempts;
                throw new AlephaError(
                  `Step '${stepName}' still asks to repeat after ${stepDef.repeat.limit} runs (repeat.limit)`,
                );
              }
              await this.repeatStep(workflow, stepExec, stepDef, handlerResult);
              return;
            }

            await this.stepExecutions.updateById(stepExec.id, {
              status: "completed",
              result:
                handlerResult != null
                  ? (handlerResult as Record<string, unknown>)
                  : undefined,
              completedAt: this.dt.nowISOString(),
            });

            await this.writeStepLogs(stepExec.id);

            this.log.info(`Workflow step '${stepName}' completed`, {
              workflowId,
            });

            await this.alepha.events.emit(
              "workflow:step:completed",
              {
                workflowName: workflow.workflowName,
                workflowId,
                stepName,
                result: handlerResult,
              },
              { catch: true },
            );

            await this.advance(workflowId);
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));

            await this.writeStepLogs(stepExec.id);

            const failure = abortController.signal.aborted
              ? new Error("Step timed out")
              : err;
            await this.handleStepFailure(workflow, stepExec, stepDef, failure);
          }
        },
        { context, ...this.logBuffer.seed(this.config.logMaxEntries) },
      );
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(abortKey);
    }
  }

  /**
   * Re-park a repeating step for its next iteration: same row, bumped
   * iteration counter, fresh retry budget, next not-before stamp. The
   * verdict object is stored as the step's interim result so the admin UI
   * shows live progress. Crash-safety mirrors retries: the stamp is
   * persisted before the delayed dispatch is pushed, and the recovery
   * sweep re-derives the wake-up from the row alone — a crash between the
   * verdict and this write replays the same iteration, which is why
   * iteration handlers must be idempotent.
   */
  protected async repeatStep(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: WorkflowStep,
    result: unknown,
  ): Promise<void> {
    const repeat = stepDef.repeat;
    if (!repeat) return;

    const iteration = (stepExec.iteration ?? 0) + 1;
    const delayMs = this.dt.duration(repeat.delay).as("milliseconds");
    const scheduledAt = this.dt.now().add(delayMs, "millisecond").toISOString();

    await this.stepExecutions.updateById(stepExec.id, {
      status: "pending",
      iteration,
      attempt: 0,
      result: result != null ? (result as Record<string, unknown>) : undefined,
      scheduledAt,
    });

    await this.writeStepLogs(stepExec.id);

    this.log.info(`Workflow step '${stepExec.stepName}' repeating`, {
      workflowId: workflow.id,
      iteration,
    });

    await this.alepha.events.emit(
      "workflow:step:repeat",
      {
        workflowName: workflow.workflowName,
        workflowId: workflow.id,
        stepName: stepExec.stepName,
        iteration,
      },
      { catch: true },
    );

    await this.dispatchStep(
      workflow.id,
      stepExec.stepName,
      workflow.priority,
      delayMs,
    );
  }

  protected async handleStepFailure(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: WorkflowStep,
    error: Error,
  ): Promise<void> {
    const retryOpts = stepDef.retry;
    const canRetry =
      retryOpts &&
      stepExec.attempt + 1 < stepExec.maxAttempts &&
      (retryOpts.when ? retryOpts.when(error) : true);

    if (canRetry) {
      const nextScheduledAt = this.computeBackoff(
        retryOpts,
        stepExec.attempt + 1,
      );

      this.log.info(
        `Workflow step '${stepExec.stepName}' failed, scheduling retry`,
        { workflowId: workflow.id, error: error.message },
      );

      await this.stepExecutions.updateById(stepExec.id, {
        status: "pending",
        error: error.message,
        scheduledAt: nextScheduledAt,
      });

      // Durable retry: the delay rides the job outbox (a scheduled row
      // plus an optimistic timer). If the process dies before delivery,
      // the jobs sweep or the workflow recovery sweep re-dispatches from
      // the persisted `scheduledAt`.
      const delayMs = Math.max(
        0,
        new Date(nextScheduledAt).getTime() - this.dt.nowMillis(),
      );
      await this.dispatchStep(
        workflow.id,
        stepExec.stepName,
        workflow.priority,
        delayMs,
      );
    } else {
      this.log.info(`Workflow step '${stepExec.stepName}' failed permanently`, {
        workflowId: workflow.id,
        error: error.message,
      });

      await this.stepExecutions.updateById(stepExec.id, {
        status: "failed",
        error: error.message,
        completedAt: this.dt.nowISOString(),
      });

      await this.alepha.events.emit(
        "workflow:step:failed",
        {
          workflowName: workflow.workflowName,
          workflowId: workflow.id,
          stepName: stepExec.stepName,
          error,
        },
        { catch: true },
      );

      const registration = this.getRegistration(workflow.workflowName);
      const onError = registration.options.onError ?? "compensate";

      if (onError === "compensate") {
        await this.compensate(workflow.id, {
          failedStep: stepExec.stepName,
          error,
        });
      } else {
        await this.executions.updateById(workflow.id, {
          status: "failed",
          error: error.message,
          errorStep: stepExec.stepName,
          completedAt: this.dt.nowISOString(),
        });

        await this.alepha.events.emit(
          "workflow:failed",
          {
            workflowName: workflow.workflowName,
            workflowId: workflow.id,
            error,
            stepName: stepExec.stepName,
          },
          { catch: true },
        );
      }
    }
  }

  // --- Advance ----------------------------------------------------------------------------------------------------

  protected async advance(workflowId: string): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow || workflow.status !== "running") return;

    const steps = await this.stepExecutions.findMany({
      where: { workflowExecutionId: { eq: workflowId } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });

    const nextStep = steps.find((s) => s.status === "pending");

    // No pending step is NOT the same as all steps settled: a sweep tick
    // can land inside a concurrent dispatch's claim window (step already
    // `running`, handler not yet executed). Completing here would race
    // the handler — its completion path advances the workflow itself.
    if (!nextStep && steps.some((s) => s.status === "running")) {
      return;
    }

    if (nextStep) {
      await this.executions.updateById(workflowId, {
        currentStep: nextStep.stepName,
      });

      // A step-level `delay` is a durable wait counted from now (the
      // previous step just completed): stamp the not-before time on the
      // step row, then let the outbox deliver it.
      const registration = this.getRegistration(workflow.workflowName);
      const stepDef = registration.options.steps.find(
        (s) => s.name === nextStep.stepName,
      );
      let delayMs = 0;
      if (stepDef?.delay && !nextStep.scheduledAt) {
        delayMs = this.dt.duration(stepDef.delay).as("milliseconds");
        await this.stepExecutions.updateById(nextStep.id, {
          scheduledAt: this.dt.now().add(delayMs, "millisecond").toISOString(),
        });
      } else if (nextStep.scheduledAt) {
        delayMs = Math.max(
          0,
          new Date(nextStep.scheduledAt).getTime() - this.dt.nowMillis(),
        );
      }

      await this.dispatchStep(
        workflowId,
        nextStep.stepName,
        workflow.priority,
        delayMs,
      );
    } else {
      await this.executions.updateById(workflowId, {
        status: "completed",
        currentStep: undefined,
        completedAt: this.dt.nowISOString(),
      });

      this.log.info(`Workflow '${workflow.workflowName}' completed`, {
        workflowId,
      });

      await this.alepha.events.emit(
        "workflow:completed",
        {
          workflowName: workflow.workflowName,
          workflowId,
        },
        { catch: true },
      );
    }
  }

  // --- Compensate -------------------------------------------------------------------------------------------------

  public async compensate(
    workflowId: string,
    context?: { failedStep?: string; error?: Error },
  ): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    const registration = this.getRegistration(workflow.workflowName);

    await this.executions.updateById(workflowId, {
      status: "compensating",
      error: context?.error?.message,
      errorStep: context?.failedStep,
    });

    await this.alepha.events.emit(
      "workflow:compensating",
      {
        workflowName: workflow.workflowName,
        workflowId,
        stepName: context?.failedStep ?? "",
      },
      { catch: true },
    );

    const completedSteps = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        status: { eq: "completed" },
      },
      orderBy: { column: "stepIndex", direction: "desc" },
    });

    const results = await this.assembleResults(workflowId);

    for (const stepExec of completedSteps) {
      const stepDef = registration.options.steps.find(
        (s) => s.name === stepExec.stepName,
      );
      if (!stepDef?.compensate) continue;

      await this.stepExecutions.updateById(stepExec.id, {
        status: "compensating",
      });

      try {
        // Fresh scope per compensation: cancel({compensate}) runs in the
        // CANCELLING caller's context (an admin request, a listener), and
        // the restored atoms must die with the handler instead of leaking
        // into it.
        await this.alepha.context.run(async () => {
          this.restoreContext(workflow);
          await stepDef.compensate?.({
            payload: workflow.payload as Infer<ZType>,
            result: stepExec.result,
            results,
            context: {
              workflowId,
              executionId: stepExec.id,
              stepName: stepExec.stepName,
              error: context?.error ?? new Error("Compensation triggered"),
            },
          });
        });

        await this.stepExecutions.updateById(stepExec.id, {
          status: "compensated",
          completedAt: this.dt.nowISOString(),
        });
      } catch (compError) {
        const err =
          compError instanceof Error ? compError : new Error(String(compError));

        this.log.error(`Compensation failed for step '${stepExec.stepName}'`, {
          workflowId,
          error: err.message,
        });

        await this.stepExecutions.updateById(stepExec.id, {
          status: "compensation_failed",
          error: err.message,
        });

        await this.executions.updateById(workflowId, {
          status: "compensation_failed",
          completedAt: this.dt.nowISOString(),
        });

        await this.alepha.events.emit(
          "workflow:compensation:failed",
          {
            workflowName: workflow.workflowName,
            workflowId,
            stepName: stepExec.stepName,
            error: err,
          },
          { catch: true },
        );

        return;
      }
    }

    await this.executions.updateById(workflowId, {
      status: "compensated",
      completedAt: this.dt.nowISOString(),
    });

    this.log.info(`Workflow '${workflow.workflowName}' compensated`, {
      workflowId,
    });

    await this.alepha.events.emit(
      "workflow:compensated",
      {
        workflowName: workflow.workflowName,
        workflowId,
      },
      { catch: true },
    );
  }

  // --- Context ----------------------------------------------------------------------------------------------------

  /**
   * Snapshot the atoms listed in the workflow's `context` option, keyed by
   * atom name, at start() time. Undefined values are skipped, and the
   * column stays null when nothing was captured — a workflow without
   * `context`, or one started outside any scope, costs nothing.
   */
  protected captureContext(
    opts: WorkflowPrimitiveOptions,
  ): Record<string, unknown> | undefined {
    const atoms = opts.context;
    if (!atoms?.length) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = {};
    for (const atom of atoms) {
      const value = this.alepha.store.get(atom);
      if (value !== undefined) {
        snapshot[atom.key] = value;
      }
    }
    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  }

  /**
   * Restore a captured snapshot into the CURRENT scope. Every caller must
   * already be inside a fresh context.run() layer, so the restored values
   * shadow the caller's state for the handler's duration and die with the
   * layer — they never leak into whichever request or job triggered the
   * dispatch.
   */
  protected restoreContext(workflow: WorkflowExecutionEntity): void {
    const snapshot = workflow.context;
    if (!snapshot) {
      return;
    }
    const atoms = this.getRegistration(workflow.workflowName).options.context;
    if (!atoms?.length) {
      return;
    }
    for (const atom of atoms) {
      if (atom.key in snapshot) {
        this.alepha.store.set(atom, snapshot[atom.key] as never);
      }
    }
  }

  // --- Cancel -----------------------------------------------------------------------------------------------------

  public async cancel(
    workflowId: string,
    options?: CancelOptions,
  ): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (workflow.status !== "pending" && workflow.status !== "running") {
      throw new AlephaError(
        `Cannot cancel workflow in '${workflow.status}' status`,
      );
    }

    for (const [key, controller] of this.abortControllers) {
      if (key.startsWith(`${workflowId}:`)) {
        controller.abort();
      }
    }

    const pendingSteps = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        status: { eq: "pending" },
      },
    });
    for (const step of pendingSteps) {
      await this.stepExecutions.updateById(step.id, { status: "cancelled" });
    }

    if (options?.compensate) {
      await this.compensate(workflowId, {
        error: new Error("Cancelled with compensation"),
      });
      await this.executions.updateById(workflowId, {
        status: "cancelled",
        cancelledBy: options?.cancelledBy,
        cancelledByName: options?.cancelledByName,
      });
    } else {
      await this.executions.updateById(workflowId, {
        status: "cancelled",
        cancelledBy: options?.cancelledBy,
        cancelledByName: options?.cancelledByName,
        completedAt: this.dt.nowISOString(),
      });
    }

    this.log.info(`Workflow cancelled`, { workflowId });

    await this.alepha.events.emit(
      "workflow:cancelled",
      {
        workflowName: workflow.workflowName,
        workflowId,
      },
      { catch: true },
    );
  }

  /**
   * Cancel the live execution armed under a dedup key, if any.
   *
   * The partial unique index guarantees at most one non-terminal execution
   * per (workflowName, key), so "the one to cancel" is well-defined.
   * Terminal rows keep their key for lookups but are not live, hence the
   * status filter. Tolerates losing the race to a terminal transition —
   * disarm-style listeners must not blow up because the workflow finished
   * a moment before they fired. Returns the cancelled execution's id, or
   * null when nothing was live under the key.
   */
  public async cancelByKey(
    workflowName: string,
    key: string,
    options?: CancelOptions,
  ): Promise<string | null> {
    const execution = await this.executions.findOne({
      where: {
        workflowName: { eq: workflowName },
        key: { eq: key },
        status: { inArray: ["pending", "running"] },
      },
    });
    if (!execution) {
      return null;
    }

    try {
      await this.cancel(execution.id, options);
    } catch (error) {
      const current = await this.executions.findById(execution.id);
      if (
        current &&
        (current.status === "pending" || current.status === "running")
      ) {
        throw error;
      }
      return null;
    }
    return execution.id;
  }

  // --- Retry ------------------------------------------------------------------------------------------------------

  public async retry(workflowId: string): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (workflow.status !== "failed" && workflow.status !== "timed_out") {
      throw new AlephaError(
        `Cannot retry workflow in '${workflow.status}' status. Use restart() for compensated workflows.`,
      );
    }

    const failedStep = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        status: { eq: "failed" },
      },
      limit: 1,
    });

    if (failedStep.length === 0) {
      throw new AlephaError("No failed step found to retry");
    }

    await this.stepExecutions.updateById(failedStep[0].id, {
      status: "pending",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      scheduledAt: undefined,
    });

    await this.executions.updateById(workflowId, {
      status: "running",
      error: undefined,
      errorStep: undefined,
      completedAt: undefined,
    });

    await this.dispatchStep(
      workflowId,
      failedStep[0].stepName,
      workflow.priority,
    );
  }

  // --- Restart ----------------------------------------------------------------------------------------------------

  public async restart(workflowId: string): Promise<string> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (
      workflow.status !== "compensated" &&
      workflow.status !== "compensation_failed" &&
      workflow.status !== "failed"
    ) {
      throw new AlephaError(
        `Cannot restart workflow in '${workflow.status}' status`,
      );
    }

    return this.start(workflow.workflowName, workflow.payload);
  }

  // --- Query ------------------------------------------------------------------------------------------------------

  public async getExecution(workflowId: string) {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    const steps = await this.stepExecutions.findMany({
      where: { workflowExecutionId: { eq: workflowId } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });

    return { ...workflow, steps };
  }

  // --- Pause / Resume ---------------------------------------------------------------------------------------------

  public pauseWorkflow(name: string): void {
    this.getRegistration(name);
    this.pausedWorkflows.add(name);
    this.log.info(`Paused workflow '${name}'`);
  }

  public async resumeWorkflow(name: string): Promise<void> {
    this.getRegistration(name);
    this.pausedWorkflows.delete(name);
    this.log.info(`Resumed workflow '${name}'`);
  }

  public isWorkflowPaused(name: string): boolean {
    return this.pausedWorkflows.has(name);
  }

  public getPausedWorkflows(): string[] {
    return [...this.pausedWorkflows];
  }

  // --- Internal dispatch ------------------------------------------------------------------------------------------

  protected async dispatchStep(
    workflowId: string,
    stepName: string,
    priority: number,
    delayMs = 0,
  ): Promise<void> {
    if (this.stopping) return;

    if (this.stepDispatch) {
      await this.stepDispatch(workflowId, stepName, priority, delayMs);
    } else if (delayMs > 0) {
      // Inline fallback (no job queue wired): a local timer is the only
      // delivery; the step's persisted `scheduledAt` plus the recovery
      // sweep remain the durable truth.
      this.dt.createTimeout(
        () => void this.processStep(workflowId, stepName),
        delayMs,
      );
    } else {
      await this.processStep(workflowId, stepName);
    }
  }

  // --- Helpers ----------------------------------------------------------------------------------------------------

  protected async assembleResults(
    workflowId: string,
  ): Promise<Record<string, unknown>> {
    const completed = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        status: { eq: "completed" },
      },
      orderBy: { column: "stepIndex", direction: "asc" },
    });
    const results: Record<string, unknown> = {};
    for (const step of completed) {
      if (step.result) results[step.stepName] = step.result;
    }
    return results;
  }

  protected async findStepExecution(
    workflowId: string,
    stepName: string,
  ): Promise<WorkflowStepExecutionEntity | undefined> {
    const rows = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        stepName: { eq: stepName },
      },
      limit: 1,
    });
    return rows[0];
  }

  protected computeBackoff(
    retryOpts: WorkflowRetryOptions,
    attempt: number,
  ): string {
    const now = this.dt.now();

    if (!retryOpts.backoff) {
      return now.add(1, "second").toISOString();
    }

    if (Array.isArray(retryOpts.backoff)) {
      const delay = this.dt.duration(retryOpts.backoff);
      return now.add(delay).toISOString();
    }

    const backoff = retryOpts.backoff as WorkflowRetryBackoff;
    const initial = this.dt.duration(backoff.initial).as("milliseconds");
    const factor = backoff.factor ?? 2;
    let delayMs = initial * factor ** (attempt - 1);

    if (backoff.max) {
      const maxMs = this.dt.duration(backoff.max).as("milliseconds");
      delayMs = Math.min(delayMs, maxMs);
    }

    if (backoff.jitter) {
      delayMs = delayMs * (0.75 + Math.random() * 0.5);
    }

    return now.add(delayMs, "millisecond").toISOString();
  }

  /**
   * Persist the ambient log buffer for a step. Must be called from inside
   * the step's `context.run` — the buffer is context-scoped.
   */
  protected async writeStepLogs(stepExecutionId: string): Promise<void> {
    const logs = this.logBuffer.snapshot();
    if (!logs || logs.length === 0) return;

    try {
      await this.stepLogs.create({ id: stepExecutionId, logs });
    } catch {
      this.log.warn(`Failed to write logs for step ${stepExecutionId}`);
    }
  }

  protected getRegistration(name: string): WorkflowRuntimeRegistration {
    const reg = this.workflows.get(name);
    if (!reg) throw new AlephaError(`Workflow not registered: ${name}`);
    return reg;
  }

  // --- Sweeps -----------------------------------------------------------------------------------------------------

  public async recoverySweep(): Promise<void> {
    if (this.stopping) return;
    return this.tracked(this.recoverySweepInner());
  }

  protected async recoverySweepInner(): Promise<void> {
    const lockValue = `${this.crypto.randomUUID()},${this.dt.nowISOString()}`;
    const result = await this.lockProvider.set(
      "_alepha:workflows:recovery-lock",
      lockValue,
      true,
      300_000,
    );
    if (result.split(",")[0] !== lockValue.split(",")[0]) return;

    try {
      const staleThreshold = this.dt
        .now()
        .subtract(this.config.recovery.staleThreshold, "millisecond")
        .toISOString();

      // Steps stuck in `running` past the stale threshold: the process that
      // claimed them is assumed dead.
      const staleSteps = await this.stepExecutions.findMany({
        where: {
          status: { eq: "running" },
          startedAt: { lte: staleThreshold },
        },
      });

      for (const step of staleSteps) {
        if (
          this.abortControllers.has(
            `${step.workflowExecutionId}:${step.stepName}`,
          )
        ) {
          continue;
        }

        this.log.warn(
          `Recovery sweep: marking stale step '${step.stepName}' as failed`,
          { workflowId: step.workflowExecutionId },
        );

        await this.stepExecutions.updateById(step.id, {
          status: "failed",
          error: "Step assumed crashed (recovered by sweep)",
          completedAt: this.dt.nowISOString(),
        });

        const workflow = await this.executions.findById(
          step.workflowExecutionId,
        );
        if (!workflow) continue;

        const registration = this.workflows.get(workflow.workflowName);
        if (!registration) continue;

        const onError = registration.options.onError ?? "compensate";
        if (onError === "compensate") {
          await this.compensate(workflow.id, {
            failedStep: step.stepName,
            error: new Error("Step assumed crashed"),
          });
        } else {
          await this.executions.updateById(workflow.id, {
            status: "failed",
            error: "Step assumed crashed",
            errorStep: step.stepName,
            completedAt: this.dt.nowISOString(),
          });
        }
      }

      // Running workflows with no step actually running: either a pending
      // step is due (a retry or delayed step whose delivery was lost with
      // the process) and must be re-dispatched, or no runnable step is
      // left and the workflow must be re-advanced to completion. The DB
      // rows are the source of truth here — every timer and outbox
      // delivery is only an optimization over this scan.
      const runningWorkflows = await this.executions.findMany({
        where: { status: { eq: "running" } },
      });

      for (const wf of runningWorkflows) {
        const active = await this.stepExecutions.findMany({
          where: {
            workflowExecutionId: { eq: wf.id },
            status: { inArray: ["running", "pending"] },
          },
          orderBy: { column: "stepIndex", direction: "asc" },
        });

        if (active.length === 0) {
          this.log.warn("Recovery sweep: re-advancing inconsistent workflow", {
            workflowId: wf.id,
          });
          await this.advance(wf.id);
          continue;
        }

        if (active.some((s) => s.status === "running")) {
          continue;
        }

        // Re-advance through advance(), not a direct dispatch: a step
        // whose `delay` stamp was lost with the crash (null scheduledAt)
        // gets stamped there and waits its full delay instead of running
        // immediately. A stamped-and-future step is left alone — its
        // scheduled delivery already exists, and re-advancing every tick
        // would pile up duplicate outbox rows.
        const next = active[0];
        const due =
          !next.scheduledAt ||
          new Date(next.scheduledAt).getTime() <= this.dt.nowMillis();
        if (due) {
          this.log.warn("Recovery sweep: re-advancing workflow with due step", {
            workflowId: wf.id,
            stepName: next.stepName,
          });
          await this.advance(wf.id);
        }
      }

      // Pending workflows past their intended start: the start dispatch
      // (or the delayed-start outbox row) was lost — dispatch the first
      // pending step now.
      const duePending = await this.executions.findMany({
        where: {
          status: { eq: "pending" },
          scheduledAt: { lte: this.dt.nowISOString() },
        },
      });

      for (const wf of duePending) {
        const first = await this.stepExecutions.findMany({
          where: {
            workflowExecutionId: { eq: wf.id },
            status: { eq: "pending" },
          },
          orderBy: { column: "stepIndex", direction: "asc" },
          limit: 1,
        });
        if (first.length === 0) continue;

        this.log.warn("Recovery sweep: dispatching overdue pending workflow", {
          workflowId: wf.id,
        });
        await this.dispatchStep(wf.id, first[0].stepName, wf.priority);
      }
    } catch (e) {
      this.log.error("Recovery sweep failed", { error: e });
    } finally {
      await this.lockProvider.del("_alepha:workflows:recovery-lock");
    }
  }

  public async timeoutSweep(): Promise<void> {
    if (this.stopping) return;
    return this.tracked(this.timeoutSweepInner());
  }

  protected async timeoutSweepInner(): Promise<void> {
    const lockValue = `${this.crypto.randomUUID()},${this.dt.nowISOString()}`;
    const result = await this.lockProvider.set(
      "_alepha:workflows:timeout-lock",
      lockValue,
      true,
      60_000,
    );
    if (result.split(",")[0] !== lockValue.split(",")[0]) return;

    try {
      const now = this.dt.nowISOString();

      const timedOutWorkflows = await this.executions.findMany({
        where: {
          status: { eq: "running" },
          deadlineAt: { lte: now },
        },
      });

      for (const wf of timedOutWorkflows) {
        this.log.warn(`Timeout sweep: workflow timed out`, {
          workflowId: wf.id,
        });

        for (const [key, controller] of this.abortControllers) {
          if (key.startsWith(`${wf.id}:`)) controller.abort();
        }

        await this.stepExecutions.updateMany(
          {
            workflowExecutionId: { eq: wf.id },
            status: { eq: "running" },
          },
          {
            status: "failed",
            error: "Workflow timed out",
            completedAt: now,
          },
        );

        await this.executions.updateById(wf.id, {
          status: "timed_out",
          completedAt: now,
        });

        await this.alepha.events.emit(
          "workflow:timed_out",
          {
            workflowName: wf.workflowName,
            workflowId: wf.id,
          },
          { catch: true },
        );

        const reg = this.workflows.get(wf.workflowName);
        if (reg?.options.onError === "compensate") {
          await this.compensate(wf.id, {
            error: new Error("Workflow timed out"),
          });
        }
      }
    } catch (e) {
      this.log.error("Timeout sweep failed", { error: e });
    } finally {
      await this.lockProvider.del("_alepha:workflows:timeout-lock");
    }
  }

  public async purge(): Promise<void> {
    if (this.stopping) return;
    return this.tracked(this.purgeInner());
  }

  protected async purgeInner(): Promise<void> {
    try {
      const cutoff = this.dt
        .now()
        .subtract(this.config.retentionDays, "day")
        .toISOString();

      const terminalStatuses: WorkflowStatus[] = [
        "completed",
        "failed",
        "compensated",
        "compensation_failed",
        "cancelled",
        "timed_out",
      ];

      const old = await this.executions.findMany({
        where: {
          status: { inArray: terminalStatuses },
          completedAt: { lte: cutoff },
        },
      });

      if (old.length > 0) {
        const ids = old.map((e) => e.id);

        // Step logs have no FK (a primary key cannot also be a reference),
        // so delete them explicitly before the executions — the step rows
        // themselves cascade with their workflow.
        const steps = await this.stepExecutions.findMany({
          where: { workflowExecutionId: { inArray: ids } },
          columns: ["id"],
        });
        if (steps.length > 0) {
          await this.stepLogs.deleteMany({
            id: { inArray: steps.map((s) => s.id) },
          });
        }

        await this.executions.deleteMany({ id: { inArray: ids } });
        this.log.info(`Purge: deleted ${ids.length} old workflow executions`);
      }
    } catch (e) {
      this.log.error("Purge failed", { error: e });
    }
  }

  // --- Lifecycle --------------------------------------------------------------------------------------------------

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.log.info("Workflow engine OK", {
        dispatch: this.stepDispatch ? "queue" : "inline",
        workflows: this.workflows.size,
      });
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      this.stopping = true;

      if (this.inFlight.size > 0) {
        this.log.info(`Draining ${this.inFlight.size} in-flight step(s)...`);
        await Promise.race([
          Promise.allSettled([...this.inFlight]),
          this.dt.wait([this.config.drainTimeout, "millisecond"]),
        ]);
      }

      if (this.abortControllers.size > 0) {
        this.log.warn(
          `Aborting ${this.abortControllers.size} remaining step(s)`,
        );
        for (const controller of this.abortControllers.values()) {
          controller.abort();
        }
      }
    },
  });
}
