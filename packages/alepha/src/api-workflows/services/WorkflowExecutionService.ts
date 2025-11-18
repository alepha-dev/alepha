import { $inject } from "../../core/descriptors/$inject.ts";
import { $repository } from "../../orm/descriptors/$repository.ts";
import { AlephaError } from "../../core/errors/AlephaError.ts";
import { DateTimeProvider } from "../../datetime/providers/DateTimeProvider.ts";
import { RetryProvider } from "../../retry/providers/RetryProvider.ts";
import { workflowExecutionEntity } from "../entities/WorkflowExecutionEntity.ts";
import { workflowEventEntity } from "../entities/WorkflowEventEntity.ts";
import { workflowSignalQueueEntity } from "../entities/WorkflowSignalQueueEntity.ts";
import { WorkflowRegistryService } from "./WorkflowRegistryService.ts";
import {
  WorkflowContext,
  SignalNotAvailableError,
  ActivityNotExecutedError,
  SleepRequestedError,
} from "./WorkflowContext.ts";

/**
 * Service for executing workflow steps and managing workflow state.
 *
 * This service handles the core workflow execution logic:
 * - Replaying events to reconstruct state
 * - Executing workflow handlers deterministically
 * - Processing signals
 * - Recording workflow events
 * - Executing activities with retries
 */
export class WorkflowExecutionService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly registry = $inject(WorkflowRegistryService);
  protected readonly retry = $inject(RetryProvider);
  protected readonly executions = $repository(workflowExecutionEntity);
  protected readonly events = $repository(workflowEventEntity);
  protected readonly signals = $repository(workflowSignalQueueEntity);

  /**
   * Execute a workflow step.
   *
   * This method implements the event-sourcing execution model:
   * 1. Loads all events and replays them to reconstruct state
   * 2. Executes the workflow handler in a deterministic context
   * 3. Handles blocking operations (activities, signals, sleep)
   * 4. Records new events for state changes
   * 5. Completes or pauses the workflow
   */
  public async executeStep(workflowId: string): Promise<void> {
    // Load workflow execution
    const execution = await this.executions.findOne({ where: { workflowId } });
    if (!execution) {
      throw new AlephaError(`Workflow ${workflowId} not found`);
    }

    // Skip if workflow is not running
    if (execution.status !== "running") {
      return;
    }

    // Load workflow definition
    const workflow = this.registry.getWorkflow(
      execution.workflowName,
      execution.workflowVersion,
    );
    if (!workflow) {
      throw new AlephaError(
        `Workflow definition ${execution.workflowName}:${execution.workflowVersion} not found`,
      );
    }

    // Load all events to replay
    const allEvents = await this.events.findMany({
      where: { workflowId },
    });

    // Sort events by sequence
    allEvents.sort((a, b) => a.sequence - b.sequence);

    // Create deterministic context
    const context = new WorkflowContext(
      workflowId,
      execution.runId,
      execution.input,
      new Date(execution.startedAt),
    );

    // Replay events to reconstruct state
    for (const event of allEvents) {
      await this.replayEvent(context, event);
    }

    // Load and deliver pending signals
    const pendingSignals = await this.signals.findMany({
      where: { workflowId, processedAt: { isNull: true } },
    });

    for (const signal of pendingSignals) {
      context.deliverSignal(signal.signalName, signal.payload);

      // Mark signal as processed
      await this.signals.updateOne(
        { signalId: signal.signalId },
        { processedAt: this.dateTime.nowISOString() },
      );

      // Record SignalReceived event
      await this.recordEvent(workflowId, "SignalReceived", {
        signalName: signal.signalName,
        payload: signal.payload,
      });
    }

    try {
      // Execute workflow handler with deterministic context
      const output = await workflow.handler(execution.input, context);

      // Workflow completed successfully
      await this.executions.updateOne(
        { workflowId },
        {
          status: "completed",
          output,
          completedAt: this.dateTime.nowISOString(),
          updatedAt: this.dateTime.nowISOString(),
        },
      );

      // Record WorkflowCompleted event
      await this.recordEvent(workflowId, "WorkflowCompleted", {
        output,
      });
    } catch (error) {
      if (error instanceof ActivityNotExecutedError) {
        // Workflow needs to execute an activity
        await this.executeActivity(
          workflowId,
          error.activityName,
          error.input,
          workflow.options.retryPolicy,
        );

        // Re-queue workflow to continue after activity completes
        // (This will be handled by the queue system)
      } else if (error instanceof SignalNotAvailableError) {
        // Workflow is waiting for a signal
        // Just pause - workflow will resume when signal arrives
        await this.recordEvent(workflowId, "WorkflowWaitingForSignal", {
          signalName: error.signalName,
        });
      } else if (error instanceof SleepRequestedError) {
        // Workflow requested to sleep
        // TODO: Implement timer-based workflow resumption
        await this.recordEvent(workflowId, "WorkflowSleeping", {
          duration: error.duration,
        });
      } else {
        // Workflow failed with error
        await this.handleWorkflowError(workflowId, workflow, error as Error, context);
      }
    }
  }

  /**
   * Replay a single event to update context state.
   */
  private async replayEvent(context: WorkflowContext, event: any): Promise<void> {
    const { eventType, eventData } = event;

    switch (eventType) {
      case "ActivityCompleted":
        context.recordActivityResult(
          eventData.activityName,
          eventData.input,
          eventData.output,
        );
        break;

      case "SignalReceived":
        context.deliverSignal(eventData.signalName, eventData.payload);
        break;

      // Other events are informational only
      case "WorkflowStarted":
      case "WorkflowCompleted":
      case "WorkflowFailed":
      case "WorkflowCanceled":
      case "ActivityScheduled":
      case "ActivityFailed":
      case "WorkflowWaitingForSignal":
      case "WorkflowSleeping":
        break;

      default:
        // Unknown event type - log but don't fail
        break;
    }
  }

  /**
   * Execute an activity with retry policy.
   */
  private async executeActivity(
    workflowId: string,
    activityName: string,
    input: any,
    retryPolicy?: any,
  ): Promise<void> {
    // Get activity definition
    const activity = this.registry.getActivity(activityName);
    if (!activity) {
      throw new AlephaError(`Activity ${activityName} not found`);
    }

    // Record ActivityScheduled event
    await this.recordEvent(workflowId, "ActivityScheduled", {
      activityName,
      input,
    });

    try {
      // Execute activity with retry policy
      const output = await this.retry.retry(
        {
          handler: async () => await activity.handler(input, {} as any),
          max: retryPolicy?.maxAttempts ?? 3,
          backoff: {
            initial: retryPolicy?.initialInterval ?? 200,
            factor: retryPolicy?.backoffCoefficient ?? 2,
            max: retryPolicy?.maximumInterval ?? 10000,
          },
        },
      );

      // Record ActivityCompleted event
      await this.recordEvent(workflowId, "ActivityCompleted", {
        activityName,
        input,
        output,
      });
    } catch (error) {
      // Record ActivityFailed event
      await this.recordEvent(workflowId, "ActivityFailed", {
        activityName,
        input,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Handle workflow error (including compensation).
   */
  private async handleWorkflowError(
    workflowId: string,
    workflow: any,
    error: Error,
    context: WorkflowContext,
  ): Promise<void> {
    // Check if workflow has compensation handler
    if (workflow.options.compensate) {
      try {
        // Update status to compensating
        await this.executions.updateOne(
          { workflowId },
          {
            status: "compensating",
            updatedAt: this.dateTime.nowISOString(),
          },
        );

        // Record compensation event
        await this.recordEvent(workflowId, "WorkflowCompensating", {
          error: error.message,
        });

        // Execute compensation
        await workflow.options.compensate(context, error);

        // Mark as failed after compensation
        await this.executions.updateOne(
          { workflowId },
          {
            status: "failed",
            error: error.message,
            completedAt: this.dateTime.nowISOString(),
            updatedAt: this.dateTime.nowISOString(),
          },
        );

        await this.recordEvent(workflowId, "WorkflowCompensated", {
          error: error.message,
        });
      } catch (compensationError) {
        // Compensation failed
        await this.executions.updateOne(
          { workflowId },
          {
            status: "failed",
            error: `${error.message} (compensation failed: ${(compensationError as Error).message})`,
            completedAt: this.dateTime.nowISOString(),
            updatedAt: this.dateTime.nowISOString(),
          },
        );

        await this.recordEvent(workflowId, "WorkflowFailed", {
          error: error.message,
          compensationError: (compensationError as Error).message,
        });
      }
    } else {
      // No compensation - just fail
      await this.executions.updateOne(
        { workflowId },
        {
          status: "failed",
          error: error.message,
          completedAt: this.dateTime.nowISOString(),
          updatedAt: this.dateTime.nowISOString(),
        },
      );

      await this.recordEvent(workflowId, "WorkflowFailed", {
        error: error.message,
      });
    }
  }

  /**
   * Record a workflow event.
   */
  private async recordEvent(
    workflowId: string,
    eventType: string,
    eventData: any,
  ): Promise<void> {
    const sequence = await this.getNextSequence(workflowId);

    await this.events.create({
      eventId: crypto.randomUUID(),
      workflowId,
      sequence,
      eventType,
      eventData,
      timestamp: this.dateTime.nowISOString(),
    });
  }

  /**
   * Get next event sequence number for a workflow.
   */
  private async getNextSequence(workflowId: string): Promise<number> {
    // Get all events to find the maximum sequence
    const allEvents = await this.events.findMany({
      where: { workflowId },
    });

    if (allEvents.length === 0) {
      return 1;
    }

    // Find max sequence
    const maxSequence = Math.max(...allEvents.map((e) => e.sequence));
    return maxSequence + 1;
  }
}
