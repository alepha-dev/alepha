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

/**
 * What a restart carries over from the execution it replaces, rather than
 * recomputing from whoever asked for the restart.
 */
interface WorkflowInheritedStart {
  /**
   * The original's captured context. A restart is usually clicked by an
   * admin, and re-capturing would put THEIR ambient atoms - their tenant -
   * on someone else's workflow.
   */
  context?: Record<string, unknown>;

  /**
   * The stored numeric priority. `WorkflowStartOptions.priority` is a name
   * (`"high"`), and the row keeps what it mapped to, so the two cannot be
   * expressed through the same field.
   */
  priority?: number;

  /**
   * Id of the execution this one replaces.
   */
  restartedFrom?: string;
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
   * Set by WorkflowJobs on start. `scheduledAt` is the step's persisted
   * not-before instant, and defers delivery durably (a scheduled outbox
   * row, not just a timer).
   *
   * An instant, not a delay, on purpose. The step row is stamped first and
   * the dispatch pushed second, and a delay recomputed from the clock at
   * push time disagrees with the stamp by however far the clock moved in
   * between. On the wall clock that is milliseconds; under `travel()` it is
   * the whole jump, and a test that saw the stamp and travelled before the
   * push landed was left with an outbox row due minutes AFTER the clock it
   * had just moved. The row parked in `running` forever, at roughly one CI
   * run in five.
   */
  public stepDispatch:
    | ((
        workflowId: string,
        stepName: string,
        priority: number,
        scheduledAt?: string,
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
    return this.startExecution(workflowName, payload, options);
  }

  /**
   * The body of {@link start}, with the fields a restart carries over from
   * the execution it replaces split out - see {@link WorkflowInheritedStart}.
   */
  protected async startExecution(
    workflowName: string,
    payload: unknown,
    options?: WorkflowStartOptions,
    inherited?: WorkflowInheritedStart,
  ): Promise<string> {
    const registration = this.getRegistration(workflowName);
    const opts = registration.options;

    const validated = this.alepha.codec.validate(opts.schema, payload);

    const priority =
      inherited?.priority ??
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
    // The stamp below is ALSO what the dispatch is scheduled from, so the
    // two cannot disagree.
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
        context: inherited?.context ?? this.captureContext(opts),
        restartedFrom: inherited?.restartedFrom,
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
          firstStepScheduledAt,
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
    // No per-workflow lock here, on purpose. There used to be one, taken
    // before the reads below and released after the handler, and a dispatch
    // that found it held returned without doing anything. It was sold as an
    // optimisation over the compare-and-set claim in `executeHandlerStep`
    // (the loser is spared the read work), but the loser's outbox row was
    // consumed all the same, so the step it carried stayed `pending` with no
    // stamp until the next recovery sweep. The holder was routinely a late
    // duplicate dispatch for the PREVIOUS step that only read and returned:
    // a real delivery was dropped for a no-op that would have released the
    // lock a few milliseconds later. The repeat-steps test parked on its
    // last step this way whenever a sweep nudge crossed the completion chain.
    //
    // Two dispatches for one step now both read, and the claim decides; the
    // loser costs three reads instead of a lost delivery. Across processes
    // nothing changes: `LockProvider` is per-isolate on Workers and on Node
    // without `alepha/lock/redis`, so the lock never excluded anything there.
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) return;

    if (workflow.status !== "running" && workflow.status !== "pending") {
      return;
    }

    const registration = this.getRegistration(workflow.workflowName);
    const stepDef = registration.options.steps.find((s) => s.name === stepName);
    if (!stepDef) return;

    const stepExec = await this.findStepExecution(workflowId, stepName);
    if (!stepExec) return;

    if (stepExec.status !== "pending") return;

    // Early arrival (an optimistic timer or a duplicate dispatch racing
    // a scheduled delay/retry): put it back until its own stamp.
    if (
      stepExec.scheduledAt &&
      new Date(stepExec.scheduledAt).getTime() > this.dt.nowMillis()
    ) {
      await this.dispatchStep(
        workflowId,
        stepName,
        workflow.priority,
        stepExec.scheduledAt,
      );
      return;
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
  }

  protected async executeHandlerStep(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: WorkflowStep,
  ): Promise<void> {
    const workflowId = workflow.id;
    const stepName = stepExec.stepName;

    // Registered BEFORE the row says `running`, and before any await that
    // could let a cancel() in: cancel() aborts whatever it finds in this
    // map, so a controller published later than the status it belongs to is
    // a controller cancel() can miss. The handler then runs on a signal
    // nobody will ever abort, and a handler that only ends on abort never
    // ends at all - it holds `inFlight` and stalls shutdown's drain.
    //
    // That ordering is why the claim below can be lost with a controller
    // already published: `previousController` is what the loser puts back.
    const abortKey = `${workflowId}:${stepName}`;
    const previousController = this.abortControllers.get(abortKey);
    const abortController = new AbortController();
    this.abortControllers.set(abortKey, abortController);

    // Remembered so the catch path can tell this timer's abort from an
    // external one (cancel(), the timeout sweep).
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Compare-and-set, not a plain write: this is the step's claim, and it
      // is the ONLY thing that makes two dispatches for one step mutually
      // exclusive, on every runtime and in one process alike. There is no
      // lock in front of it any more (see processStepInner): two dispatches
      // both read `pending`, both get here, and exactly one row update wins.
      // Without this guard both would run the handler concurrently, a
      // stronger requirement than the "idempotent under replay" handlers are
      // documented to satisfy.
      const claimed = await this.stepExecutions.updateMany(
        { id: { eq: stepExec.id }, status: { eq: "pending" } },
        {
          status: "running",
          attempt: stepExec.attempt + 1,
          startedAt: this.dt.nowISOString(),
        },
      );
      if (claimed.length === 0) {
        this.log.debug(
          `Workflow step '${stepName}' claimed by another dispatch, skipping`,
          { workflowId },
        );
        return;
      }

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

      const timeoutMs = stepDef.timeout
        ? this.dt.duration(stepDef.timeout).as("milliseconds")
        : this.config.defaultStepTimeout;
      timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, timeoutMs);

      const context = this.alepha.context.createContextId();

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

            if (abortController.signal.aborted && !timedOut) {
              // Aborted from outside the step: cancel() or the timeout sweep
              // has already decided the execution's fate. Retrying or
              // compensating here would fight that decision (a plain cancel
              // used to end as "compensated" with the error "Step timed out").
              const current = await this.executions.findById(workflowId);
              const timedOutByWorkflow = current?.status === "timed_out";
              await this.stepExecutions.updateById(stepExec.id, {
                status: timedOutByWorkflow ? "failed" : "cancelled",
                error: timedOutByWorkflow
                  ? "Workflow timed out"
                  : "Step cancelled",
              });
              return;
            }

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
      // Retract only our own controller. A dispatch that lost the claim
      // published one before it could find out (see the #1111 ordering
      // above), so it has to put back whatever it displaced rather than
      // leave `cancel()` with nothing to abort for the run that won.
      if (this.abortControllers.get(abortKey) === abortController) {
        if (previousController) {
          this.abortControllers.set(abortKey, previousController);
        } else {
          this.abortControllers.delete(abortKey);
        }
      }
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
   *
   * The re-park is guarded on `running` for the same reason the claim is a
   * compare-and-set: this runs after the handler resolved, and a `cancel()`
   * that landed in that window has already written `cancelled`. An unguarded
   * write would park the row back to `pending` and the next dispatch would
   * resurrect a step the caller cancelled.
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

    const reparked = await this.stepExecutions.updateMany(
      { id: { eq: stepExec.id }, status: { eq: "running" } },
      {
        status: "pending",
        iteration,
        attempt: 0,
        result:
          result != null ? (result as Record<string, unknown>) : undefined,
        scheduledAt,
      },
    );
    if (reparked.length === 0) {
      this.log.debug(
        `Workflow step '${stepExec.stepName}' left 'running' before its repeat, not re-parking`,
        { workflowId: workflow.id, iteration },
      );
      return;
    }

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
      scheduledAt,
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

      // Durable retry: the wait rides the job outbox (a scheduled row
      // plus an optimistic timer). If the process dies before delivery,
      // the jobs sweep or the workflow recovery sweep re-dispatches from
      // the persisted `scheduledAt`.
      await this.dispatchStep(
        workflow.id,
        stepExec.stepName,
        workflow.priority,
        nextScheduledAt,
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
        // Guarded for the same reason as the completion write in
        // `advance()`, which is the other half of this race: the step is
        // already `failed` here, so a sweep tick that lands now sees no
        // active step and tries to complete the execution.
        const failed = await this.claimExecution(
          workflow.id,
          ["running", "pending"],
          {
            status: "failed",
            error: error.message,
            errorStep: stepExec.stepName,
            completedAt: this.dt.nowISOString(),
          },
        );

        if (!failed) return;

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
      let scheduledAt = nextStep.scheduledAt ?? undefined;
      if (stepDef?.delay && !scheduledAt) {
        scheduledAt = this.dt
          .now()
          .add(this.dt.duration(stepDef.delay))
          .toISOString();
        await this.stepExecutions.updateById(nextStep.id, { scheduledAt });
      }

      await this.dispatchStep(
        workflowId,
        nextStep.stepName,
        workflow.priority,
        scheduledAt,
      );
    } else {
      // Guarded, like every other execution transition. The `running` check
      // at the top of this method is a read, and a sweep tick reaches here
      // through it: a step that has just been marked `failed` is neither
      // pending nor running, so `advance()` falls through to completion
      // while `handleStepFailure` is concurrently writing `failed`. An
      // unguarded write then stamps `completed` over a failed execution —
      // observed under load as a `completed` row carrying an `error` and an
      // `errorStep`, which is a state nothing downstream can read sensibly.
      const completed = await this.claimExecution(workflowId, ["running"], {
        status: "completed",
        currentStep: undefined,
        completedAt: this.dt.nowISOString(),
      });

      // Someone else settled it (failed, cancelled, timed out). Their
      // verdict stands, and `workflow:completed` must not be announced for
      // an execution that did not complete.
      if (!completed) return;

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

  // --- Execution claim --------------------------------------------------------------------------------------------

  /**
   * Move an execution from one of `from` into `patch`, in one guarded write.
   *
   * The execution-level transitions used to read the status, compare it and
   * only then write, which is three steps a concurrent caller can land in
   * the middle of. `compensate()` alone is reachable from four places at
   * once — a step failure, `cancel({ compensate })`, the recovery sweep and
   * the admin endpoint — so two of them arriving together both read
   * `failed`, both passed the comparison, and both ran every compensation
   * handler. Tightening the comparison into a throw only moved the coin
   * flip: whichever caller read second saw `compensating` and threw.
   *
   * This is the same claim the step transitions already use, and the same
   * one `JobProvider.cancel` uses on job executions — the execution rows
   * were simply never migrated with them.
   *
   * Returns true to the single winner and false to everyone else;
   * {@link settleLostClaim} decides what losing meant.
   *
   * Deliberately does NOT re-read and return the claimed row, even though
   * `updateMany` hands back ids rather than rows. A re-read here put a
   * whole database round trip between the write and the `workflow:*` event
   * that follows it, and a test polling the row every 10ms then saw
   * `completed` and asserted on the events before the emit had run — green
   * on an idle machine, 2 in 19 under load. Every caller already holds the
   * row from its own read; none of them reads `status` off it, which is the
   * only field this call supersedes.
   */
  protected async claimExecution(
    workflowId: string,
    from: WorkflowStatus[],
    patch: Partial<WorkflowExecutionEntity>,
  ): Promise<boolean> {
    const claimed = await this.executions.updateMany(
      { id: { eq: workflowId }, status: { inArray: from } },
      patch,
    );
    return claimed.length > 0;
  }

  /**
   * Decide what a lost claim meant, and either return quietly or throw.
   *
   * A guarded UPDATE that matched nothing is two situations wearing one
   * face: another caller got there first (benign — the transition the
   * caller asked for has happened, just not by their hand), or the
   * execution was never in a status this transition is legal from (an
   * error the caller has to see). Only a re-read tells them apart, and
   * only the second one deserves a throw.
   */
  protected async settleLostClaim(
    workflowId: string,
    verb: string,
    benign: WorkflowStatus[],
    hint = "",
  ): Promise<void> {
    const current = await this.executions.findById(workflowId);
    if (!current) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (benign.includes(current.status)) {
      this.log.debug(
        `Workflow is already '${current.status}', skipping ${verb}`,
        { workflowId },
      );
      return;
    }

    throw new AlephaError(
      `Cannot ${verb} workflow in '${current.status}' status.${hint}`,
    );
  }

  // --- Compensate -------------------------------------------------------------------------------------------------

  public async compensate(
    workflowId: string,
    context?: { failedStep?: string; error?: Error },
  ): Promise<void> {
    // Advisory: it names the workflow so an unregistered name still throws
    // before anything is written, and it gives "not found" its own message.
    // The claim below, not this read, is what decides the transition.
    const existing = await this.executions.findById(workflowId);
    if (!existing) throw new AlephaError(`Workflow not found: ${workflowId}`);
    this.getRegistration(existing.workflowName);

    // Without a failure context this is the public/admin entry point, which
    // has to be as strict as cancel()/retry(): compensating a completed or a
    // running execution re-runs every compensation handler against work
    // that was never undone. With one, the caller has already established
    // the failure and comes from wherever that failure was noticed.
    const from: WorkflowStatus[] = context
      ? ["pending", "running", "failed", "timed_out"]
      : ["failed", "timed_out"];

    const claimed = await this.claimExecution(workflowId, from, {
      status: "compensating",
      error: context?.error?.message,
      errorStep: context?.failedStep,
    });

    if (!claimed) {
      // An internal caller (a step failure, a sweep) losing to a `cancel()`
      // must not throw: `executeHandlerStep` already declines to fight a
      // cancellation it finds in progress, and this is the same decision one
      // frame further out. The admin entry point does throw on `cancelled` —
      // there, "compensate a cancelled execution" is a request to refuse,
      // not a race to absorb.
      const benign: WorkflowStatus[] = [
        "compensating",
        "compensated",
        "compensation_failed",
      ];
      if (context) benign.push("cancelled");

      await this.settleLostClaim(workflowId, "compensate", benign);
      return;
    }

    await this.runCompensation(existing, context);
  }

  /**
   * Run every compensation handler, newest completed step first.
   *
   * Split out of {@link compensate} so the caller that has ALREADY claimed
   * the execution does not have to claim it twice: `cancel({ compensate })`
   * parks the row in `compensating` itself, because the loop has to finish
   * before the row is allowed to say `cancelled`.
   */
  protected async runCompensation(
    workflow: WorkflowExecutionEntity,
    context?: { failedStep?: string; error?: Error },
  ): Promise<void> {
    const workflowId = workflow.id;
    const registration = this.getRegistration(workflow.workflowName);

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

      // Compare-and-set, for the reason the step claim is one. `compensate()`
      // takes NO lock at all — it is reachable from handleStepFailure, from
      // cancel({ compensate }), from the recovery sweep and from the admin
      // endpoint — so two callers can read the same `completed` steps and run
      // the same compensation handler twice, concurrently, on every runtime.
      // Undoing work twice is not what "idempotent under replay" covers.
      const claimed = await this.stepExecutions.updateMany(
        { id: { eq: stepExec.id }, status: { eq: "completed" } },
        { status: "compensating" },
      );
      if (claimed.length === 0) {
        this.log.debug(
          `Step '${stepExec.stepName}' is already being compensated elsewhere, skipping`,
          { workflowId },
        );
        continue;
      }

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
    const existing = await this.executions.findById(workflowId);
    if (!existing) throw new AlephaError(`Workflow not found: ${workflowId}`);

    // Claimed BEFORE the abort, for the reason `JobProvider.cancel` claims
    // before its abort: the abort makes the running handler throw, and its
    // failure path writes a status of its own. Claiming second lets a
    // legitimate cancellation lose to the failure it just caused.
    //
    // With `compensate` the claim parks the row in `compensating` rather
    // than `cancelled`, because the compensation loop has to finish before
    // the execution is allowed to call itself cancelled.
    const cancellation = new Error("Cancelled with compensation");
    const claimed = await this.claimExecution(
      workflowId,
      ["pending", "running"],
      options?.compensate
        ? { status: "compensating", error: cancellation.message }
        : {
            status: "cancelled",
            cancelledBy: options?.cancelledBy,
            cancelledByName: options?.cancelledByName,
            completedAt: this.dt.nowISOString(),
          },
    );

    if (!claimed) {
      // Only an already-cancelled execution is a benign loss. Cancelling one
      // that is compensating or terminal stays an error, as it always was.
      await this.settleLostClaim(workflowId, "cancel", ["cancelled"]);
      return;
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
      await this.runCompensation(existing, { error: cancellation });
      await this.executions.updateById(workflowId, {
        status: "cancelled",
        cancelledBy: options?.cancelledBy,
        cancelledByName: options?.cancelledByName,
      });
    }

    this.log.info(`Workflow cancelled`, { workflowId });

    await this.alepha.events.emit(
      "workflow:cancelled",
      {
        workflowName: existing.workflowName,
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
    const existing = await this.executions.findById(workflowId);
    if (!existing) throw new AlephaError(`Workflow not found: ${workflowId}`);

    // Advisory, exactly as in `JobProvider.cancel`: it keeps the useful
    // message for the ordinary case (retrying a `completed` execution says
    // so, rather than "no failed step"). The claim below is what actually
    // decides, so this read being stale costs nothing.
    if (existing.status !== "failed" && existing.status !== "timed_out") {
      throw new AlephaError(
        `Cannot retry workflow in '${existing.status}' status. Use restart() for compensated workflows.`,
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

    // Recomputed from the retry instant, exactly as `start()` computes it.
    // Carried over, a `timed_out` execution went back to `running` with a
    // deadline already in the past, and the very next sweep killed it before
    // the retried step could run: retrying a timeout was a no-op that looked
    // like a failure of the handler.
    let deadlineAt: string | undefined;
    const { timeout } = this.getRegistration(existing.workflowName).options;
    if (timeout) {
      deadlineAt = this.dt.now().add(this.dt.duration(timeout)).toISOString();
    }

    // The execution is claimed before the step is reset, so a second caller
    // cannot rewind a step the winner has already re-dispatched.
    const retried = await this.claimExecution(
      workflowId,
      ["failed", "timed_out"],
      {
        status: "running",
        error: undefined,
        errorStep: undefined,
        completedAt: undefined,
        // Cleared when the workflow declares no timeout, which is the state
        // `start()` would have left it in.
        deadlineAt,
      },
    );

    if (!retried) {
      // Someone else retried it; it is already on its way.
      await this.settleLostClaim(
        workflowId,
        "retry",
        ["running", "pending"],
        " Use restart() for compensated workflows.",
      );
      return;
    }

    await this.stepExecutions.updateById(failedStep[0].id, {
      status: "pending",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      scheduledAt: undefined,
    });

    await this.dispatchStep(
      workflowId,
      failedStep[0].stepName,
      existing.priority,
    );
  }

  // --- Restart ----------------------------------------------------------------------------------------------------

  public async restart(workflowId: string): Promise<string> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    // Deliberately still a plain read-then-check, unlike compensate/cancel/
    // retry: restart does not transition this row at all, it creates a new
    // execution from it, so there is no status to claim. Two concurrent
    // restarts therefore both pass and both start one — a duplicate rather
    // than a spurious throw. A `key` closes it (the dedup check in
    // `startExecution` collapses the second onto the first); closing it for
    // keyless restarts needs a marker column on the source row, which is a
    // migration, not a rewrite of this guard.
    if (
      workflow.status !== "compensated" &&
      workflow.status !== "compensation_failed" &&
      workflow.status !== "failed"
    ) {
      throw new AlephaError(
        `Cannot restart workflow in '${workflow.status}' status`,
      );
    }

    // Everything comes off the stored row. Restarting used to call `start()`
    // bare, which meant the new execution took its context from whoever
    // clicked restart (an admin's tenant, on someone else's workflow) and
    // dropped the key, tags, priority and triggeredBy entirely.
    //
    // The key comes along too, so a restart re-arms the same dedup slot. If
    // something else has since started a live execution under it, the dedup
    // check in `startExecution` returns that one rather than creating a
    // second - which is what the key is for.
    return this.startExecution(
      workflow.workflowName,
      workflow.payload,
      {
        key: workflow.key ?? undefined,
        tags: workflow.tags,
        triggeredBy: workflow.triggeredBy,
        triggeredByName: workflow.triggeredByName,
      },
      {
        context: workflow.context,
        priority: workflow.priority,
        restartedFrom: workflow.id,
      },
    );
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

  /**
   * Deliver a step, now or at `scheduledAt`.
   *
   * `scheduledAt` is the instant already persisted on the step row, never a
   * delay recomputed here: see {@link stepDispatch} for what a second clock
   * read cost. A stamp that has already passed is delivered immediately.
   */
  protected async dispatchStep(
    workflowId: string,
    stepName: string,
    priority: number,
    scheduledAt?: string,
  ): Promise<void> {
    if (this.stopping) return;

    const remainingMs = scheduledAt
      ? new Date(scheduledAt).getTime() - this.dt.nowMillis()
      : 0;

    if (this.stepDispatch) {
      await this.stepDispatch(
        workflowId,
        stepName,
        priority,
        remainingMs > 0 ? scheduledAt : undefined,
      );
    } else if (remainingMs > 0) {
      // Inline fallback (no job queue wired): a local timer is the only
      // delivery; the step's persisted `scheduledAt` plus the recovery
      // sweep remain the durable truth.
      this.dt.createTimeout(
        () => void this.processStep(workflowId, stepName),
        remainingMs,
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
      // Upsert: a retried or repeated step writes under the same id, and a
      // plain insert refused every attempt after the first.
      await this.stepLogs.upsert(
        { id: stepExecutionId, logs },
        { target: ["id"], set: { logs } },
      );
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

        // Guarded like the other terminal writes: the deadline scan and
        // this write are two statements, and a step can complete the
        // execution in between. Timing out a workflow that finished on its
        // own is a false alarm, and a compensation of work that succeeded.
        const timedOut = await this.claimExecution(wf.id, ["running"], {
          status: "timed_out",
          completedAt: now,
        });

        if (!timedOut) continue;

        await this.alepha.events.emit(
          "workflow:timed_out",
          {
            workflowName: wf.workflowName,
            workflowId: wf.id,
          },
          { catch: true },
        );

        const reg = this.workflows.get(wf.workflowName);
        // Same default as the failure path: `onError` is "compensate" unless
        // the workflow says otherwise.
        if ((reg?.options.onError ?? "compensate") === "compensate") {
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
          Promise.allSettled(this.inFlight),
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
