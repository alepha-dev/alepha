import {
  $hook,
  $inject,
  $state,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import type { LogEntry } from "alepha/logger";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
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
  HandlerStep,
  WorkflowPrimitive,
  WorkflowPrimitiveOptions,
  WorkflowRetryBackoff,
  WorkflowRetryOptions,
  WorkflowStartOptions,
} from "../primitives/$workflow.ts";
import { workflowConfig } from "../schemas/workflowConfigAtom.ts";

// -----------------------------------------------------------------------------------------------------------------

const PRIORITY_MAP: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

interface WorkflowRegistration {
  name: string;
  options: WorkflowPrimitiveOptions;
}

export interface CancelOptions {
  compensate?: boolean;
  cancelledBy?: string;
  cancelledByName?: string;
}

// -----------------------------------------------------------------------------------------------------------------

export class WorkflowProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly lockProvider = $inject(LockProvider);
  protected readonly config = $state(workflowConfig);
  protected readonly log = $logger();
  protected readonly executions = $repository(workflowExecutions);
  protected readonly stepExecutions = $repository(workflowStepExecutions);
  protected readonly stepLogs = $repository(workflowStepLogs);

  protected readonly workflows = new Map<string, WorkflowRegistration>();
  protected readonly pausedWorkflows = new Set<string>();
  protected readonly inFlight = new Set<Promise<void>>();
  protected readonly abortControllers = new Map<string, AbortController>();
  protected readonly logs = new Map<string, LogEntry[]>();
  protected stopping = false;

  /**
   * When set, step dispatches go through a queue.
   * Set by WorkflowJobs on start.
   */
  public stepDispatch:
    | ((
        workflowId: string,
        stepName: string,
        priority: number,
      ) => Promise<void>)
    | null = null;

  // --- Registration ---

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

  public getRegisteredWorkflows(): Map<string, WorkflowRegistration> {
    return this.workflows;
  }

  // --- Start ---

  public async start(
    workflowName: string,
    payload: unknown,
    options?: WorkflowStartOptions,
  ): Promise<string> {
    const registration = this.getRegistration(workflowName);
    const opts = registration.options;

    // Validate payload
    const validated = this.alepha.codec.validate(opts.schema, payload);

    const priority =
      PRIORITY_MAP[options?.priority ?? opts.priority ?? "normal"];
    const status: WorkflowStatus = options?.delay ? "pending" : "running";

    // Compute deadline
    let deadlineAt: string | undefined;
    if (opts.timeout) {
      deadlineAt = this.dt
        .now()
        .add(this.dt.duration(opts.timeout))
        .toISOString();
    }

    // Keyed deduplication
    if (options?.key) {
      const existing = await this.executions.findMany({
        where: {
          workflowName: { eq: workflowName },
          key: { eq: options.key },
          status: {
            inArray: [
              "pending",
              "running",
              "waiting_for_signal",
              "compensating",
            ],
          },
        },
        limit: 1,
      });
      if (existing.length > 0) {
        return existing[0].id;
      }
    }

    // Create workflow execution
    const execution = await this.executions.create({
      workflowName,
      payload: validated as Record<string, unknown>,
      status,
      priority,
      deadlineAt,
      key: options?.key,
      triggeredBy: options?.triggeredBy,
      triggeredByName: options?.triggeredByName,
      tags: options?.tags ?? opts.tags,
      startedAt: status === "running" ? this.dt.nowISOString() : undefined,
    });

    // Create step execution records
    for (let i = 0; i < opts.steps.length; i++) {
      const step = opts.steps[i];
      const retryOpts = step.retry;
      await this.stepExecutions.create({
        workflowExecutionId: execution.id,
        stepName: step.name,
        stepIndex: i,
        stepType: step.type ?? "handler",
        status: "pending",
        maxAttempts: (retryOpts?.retries ?? 0) + 1,
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

    // Dispatch first step
    if (status === "running" && !this.stopping) {
      const firstStep = opts.steps[0];
      if (firstStep) {
        await this.dispatchStep(execution.id, firstStep.name, priority);
      } else {
        // No steps — complete immediately
        await this.executions.updateById(execution.id, {
          status: "completed",
          completedAt: this.dt.nowISOString(),
        });
      }
    }

    return execution.id;
  }

  // --- Process Step ---

  public async processStep(
    workflowId: string,
    stepName: string,
  ): Promise<void> {
    const promise = this.processStepInner(workflowId, stepName);
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
    // Acquire workflow-level lock
    const lockKey = `workflow:${workflowId}`;
    const lockValue = `${crypto.randomUUID()},${this.dt.nowISOString()}`;
    const lockResult = await this.lockProvider.set(
      lockKey,
      lockValue,
      true,
      600_000,
    );
    const [lockId] = lockResult.split(",");
    if (lockId !== lockValue.split(",")[0]) {
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

      // Transition pending → running if needed
      if (workflow.status === "pending") {
        await this.executions.updateById(workflowId, {
          status: "running",
          startedAt: this.dt.nowISOString(),
        });
      }

      const registration = this.getRegistration(workflow.workflowName);
      const stepDef = registration.options.steps.find(
        (s) => s.name === stepName,
      );
      if (!stepDef) return;

      const stepExec = await this.findStepExecution(workflowId, stepName);
      if (!stepExec) return;

      if (stepExec.status !== "pending") return;

      // Check when() condition
      if (stepDef.when) {
        const results = await this.assembleResults(workflowId);
        const shouldRun = await stepDef.when({
          payload: workflow.payload as Static<TSchema>,
          results,
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

      // Handler step execution
      await this.executeHandlerStep(workflow, stepExec, stepDef as HandlerStep);
    } finally {
      await this.lockProvider.del(lockKey);
    }
  }

  protected async executeHandlerStep(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: HandlerStep,
  ): Promise<void> {
    const workflowId = workflow.id;
    const stepName = stepExec.stepName;

    // Claim step
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

    // Set up abort controller
    const abortController = new AbortController();
    const abortKey = `${workflowId}:${stepName}`;
    this.abortControllers.set(abortKey, abortController);

    // Set up timeout
    const timeoutMs = stepDef.timeout
      ? this.dt.duration(stepDef.timeout).as("milliseconds")
      : this.config.defaultStepTimeout;
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    // Capture logs
    const context = this.alepha.context.createContextId();
    this.logs.set(context, []);

    try {
      await this.alepha.context.run(
        async () => {
          const results = await this.assembleResults(workflowId);

          const handlerResult = await stepDef.handler({
            payload: workflow.payload as Static<TSchema>,
            results,
            context: {
              workflowId,
              executionId: stepExec.id,
              stepName,
              attempt: stepExec.attempt + 1,
            },
            signal: abortController.signal,
          });

          // Success
          await this.stepExecutions.updateById(stepExec.id, {
            status: "completed",
            result:
              handlerResult != null
                ? (handlerResult as Record<string, unknown>)
                : undefined,
            completedAt: this.dt.nowISOString(),
          });

          await this.writeLogs(stepExec.id, context);

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

          // Advance to next step
          await this.advance(workflowId);
        },
        { context },
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      await this.writeLogs(stepExec.id, context);

      if (abortController.signal.aborted) {
        // Timeout — treat as failure
        await this.handleStepFailure(
          workflow,
          stepExec,
          stepDef,
          new Error("Step timed out"),
          context,
        );
      } else {
        await this.handleStepFailure(workflow, stepExec, stepDef, err, context);
      }
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(abortKey);
      this.logs.delete(context);
    }
  }

  protected async handleStepFailure(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: HandlerStep,
    error: Error,
    _context: string,
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
        deadlineAt: nextScheduledAt,
      });

      // Schedule retry after backoff
      const delayMs = Math.max(
        0,
        new Date(nextScheduledAt).getTime() - this.dt.nowMillis(),
      );
      this.dt.createTimeout(
        () =>
          void this.dispatchStep(
            workflow.id,
            stepExec.stepName,
            workflow.priority,
          ),
        delayMs,
      );
    } else {
      // Step exhausted — mark failed
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

      // Determine error strategy
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

  // --- Advance ---

  protected async advance(workflowId: string): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow || workflow.status !== "running") return;

    const registration = this.getRegistration(workflow.workflowName);

    // Find next pending step by index
    const steps = await this.stepExecutions.findMany({
      where: { workflowExecutionId: { eq: workflowId } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });

    const nextStep = steps.find((s) => s.status === "pending");

    if (nextStep) {
      await this.executions.updateById(workflowId, {
        currentStep: nextStep.stepName,
      });
      await this.dispatchStep(workflowId, nextStep.stepName, workflow.priority);
    } else {
      // All steps done
      await this.executions.updateById(workflowId, {
        status: "completed",
        currentStep: undefined,
        completedAt: this.dt.nowISOString(),
        key: null,
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

  // --- Compensate ---

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

    // Get completed steps in reverse order
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
        await stepDef.compensate({
          payload: workflow.payload as Static<TSchema>,
          result: stepExec.result,
          results,
          context: {
            workflowId,
            executionId: stepExec.id,
            stepName: stepExec.stepName,
            error: context?.error ?? new Error("Compensation triggered"),
          },
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
          key: null,
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

    // All compensations succeeded
    await this.executions.updateById(workflowId, {
      status: "compensated",
      completedAt: this.dt.nowISOString(),
      key: null,
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

  // --- Cancel ---

  public async cancel(
    workflowId: string,
    options?: CancelOptions,
  ): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (
      workflow.status !== "pending" &&
      workflow.status !== "running" &&
      workflow.status !== "waiting_for_signal"
    ) {
      throw new AlephaError(
        `Cannot cancel workflow in '${workflow.status}' status`,
      );
    }

    // Abort any running step
    for (const [key, controller] of this.abortControllers) {
      if (key.startsWith(`${workflowId}:`)) {
        controller.abort();
      }
    }

    // Cancel all pending/waiting steps
    const pendingSteps = await this.stepExecutions.findMany({
      where: {
        workflowExecutionId: { eq: workflowId },
        status: { inArray: ["pending", "waiting"] },
      },
    });
    for (const step of pendingSteps) {
      await this.stepExecutions.updateById(step.id, { status: "cancelled" });
    }

    if (options?.compensate) {
      await this.compensate(workflowId, {
        error: new Error("Cancelled with compensation"),
      });
      // After compensation, mark as cancelled (override compensated status)
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
        key: null,
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

  // --- Signal ---

  /**
   * Send a signal to a waiting workflow step.
   */
  public async signal(
    workflowId: string,
    stepName: string,
    payload?: unknown,
    signalledBy?: string,
  ): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (workflow.status !== "waiting_for_signal") {
      throw new AlephaError(
        `Cannot signal workflow in '${workflow.status}' status`,
      );
    }

    const stepExec = await this.findStepExecution(workflowId, stepName);
    if (!stepExec) {
      throw new AlephaError(
        `Step '${stepName}' not found on workflow ${workflowId}`,
      );
    }

    if (stepExec.status !== "waiting") {
      throw new AlephaError(
        `Step '${stepName}' is in '${stepExec.status}' status, expected 'waiting'`,
      );
    }

    await this.stepExecutions.updateById(stepExec.id, {
      status: "completed",
      signalPayload:
        payload != null ? (payload as Record<string, unknown>) : undefined,
      signalledBy,
      signalledAt: this.dt.nowISOString(),
      completedAt: this.dt.nowISOString(),
    });

    // Resume workflow
    await this.executions.updateById(workflowId, {
      status: "running",
    });

    this.log.info(`Workflow signalled step '${stepName}'`, { workflowId });

    // Advance to next step
    await this.advance(workflowId);
  }

  // --- Retry ---

  public async retry(workflowId: string): Promise<void> {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    if (workflow.status !== "failed" && workflow.status !== "timed_out") {
      throw new AlephaError(
        `Cannot retry workflow in '${workflow.status}' status. Use restart() for compensated workflows.`,
      );
    }

    // Find the failed step
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

    // Reset the failed step
    await this.stepExecutions.updateById(failedStep[0].id, {
      status: "pending",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });

    // Resume workflow
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

  // --- Restart ---

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

  // --- Query ---

  public async getExecution(workflowId: string) {
    const workflow = await this.executions.findById(workflowId);
    if (!workflow) throw new AlephaError(`Workflow not found: ${workflowId}`);

    const steps = await this.stepExecutions.findMany({
      where: { workflowExecutionId: { eq: workflowId } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });

    return { ...workflow, steps };
  }

  // --- Pause / Resume ---

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

  // --- Internal dispatch ---

  protected async dispatchStep(
    workflowId: string,
    stepName: string,
    priority: number,
  ): Promise<void> {
    if (this.stopping) return;

    if (this.stepDispatch) {
      await this.stepDispatch(workflowId, stepName, priority);
    } else {
      await this.processStep(workflowId, stepName);
    }
  }

  // --- Helpers ---

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

  protected async writeLogs(
    stepExecutionId: string,
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
        timestamp: this.dt.nowMillis(),
        service: "alepha.workflows",
        module: "WorkflowProvider",
      } as LogEntry);
    }

    try {
      await this.stepLogs.create({ id: stepExecutionId, logs });
    } catch {
      this.log.warn(`Failed to write logs for step ${stepExecutionId}`);
    }
  }

  protected getRegistration(name: string): WorkflowRegistration {
    const reg = this.workflows.get(name);
    if (!reg) throw new AlephaError(`Workflow not registered: ${name}`);
    return reg;
  }

  // --- Sweeps ---

  public async recoverySweep(): Promise<void> {
    if (this.stopping) return;

    const lockValue = `${crypto.randomUUID()},${this.dt.nowISOString()}`;
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

      // Find stale running steps
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

      // Find inconsistent workflows (running but no active steps)
      const runningWorkflows = await this.executions.findMany({
        where: { status: { eq: "running" } },
      });

      for (const wf of runningWorkflows) {
        const activeSteps = await this.stepExecutions.findMany({
          where: {
            workflowExecutionId: { eq: wf.id },
            status: { inArray: ["running", "pending"] },
          },
          limit: 1,
        });

        if (activeSteps.length === 0) {
          this.log.warn("Recovery sweep: re-advancing inconsistent workflow", {
            workflowId: wf.id,
          });
          await this.advance(wf.id);
        }
      }
    } catch (e) {
      this.log.error("Recovery sweep failed", { error: e });
    } finally {
      await this.lockProvider.del("_alepha:workflows:recovery-lock");
    }
  }

  public async timeoutSweep(): Promise<void> {
    if (this.stopping) return;

    const lockValue = `${crypto.randomUUID()},${this.dt.nowISOString()}`;
    const result = await this.lockProvider.set(
      "_alepha:workflows:timeout-lock",
      lockValue,
      true,
      60_000,
    );
    if (result.split(",")[0] !== lockValue.split(",")[0]) return;

    try {
      const now = this.dt.nowISOString();

      // Workflow-level timeouts
      const timedOutWorkflows = await this.executions.findMany({
        where: {
          status: { inArray: ["running", "waiting_for_signal"] },
          deadlineAt: { lte: now },
        },
      });

      for (const wf of timedOutWorkflows) {
        this.log.warn(`Timeout sweep: workflow timed out`, {
          workflowId: wf.id,
        });

        // Abort any running step
        for (const [key, controller] of this.abortControllers) {
          if (key.startsWith(`${wf.id}:`)) controller.abort();
        }

        // Mark running steps as failed
        await this.stepExecutions.updateMany(
          {
            workflowExecutionId: { eq: wf.id },
            status: { inArray: ["running", "waiting"] },
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
        // Step logs and step executions cascade-delete with the workflow
        await this.executions.deleteMany({ id: { inArray: ids } });
        this.log.info(`Purge: deleted ${ids.length} old workflow executions`);
      }
    } catch (e) {
      this.log.error("Purge failed", { error: e });
    }
  }

  // --- Lifecycle ---

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.log.info("Workflow engine OK", {
        dispatch: this.stepDispatch ? "queue" : "inline",
        workflows: this.workflows.size,
      });

      // Log capture listener
      this.alepha.events.on("log", ({ entry }) => {
        const ctx = entry.context;
        if (!ctx) return;
        const entries = this.logs.get(ctx);
        if (!entries) return;
        entries.push(entry);
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
