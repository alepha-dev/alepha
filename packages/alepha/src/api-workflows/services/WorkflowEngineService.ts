import { $inject } from "../../core/descriptors/$inject.ts";
import { $repository } from "../../orm/descriptors/$repository.ts";
import type { Atom } from "../../core/descriptors/$atom.ts";
import type { Workflow } from "../descriptors/$workflow.ts";
import { AlephaError } from "../../core/errors/AlephaError.ts";
import { DateTimeProvider } from "../../datetime/providers/DateTimeProvider.ts";
import { workflowExecutionEntity } from "../entities/WorkflowExecutionEntity.ts";
import { workflowEventEntity } from "../entities/WorkflowEventEntity.ts";
import { workflowSignalQueueEntity } from "../entities/WorkflowSignalQueueEntity.ts";
import { WorkflowRegistryService } from "./WorkflowRegistryService.ts";
import { WorkflowQueues } from "../queues/WorkflowQueues.ts";

/**
 * Main workflow orchestration engine.
 *
 * Handles:
 * - Starting workflow executions
 * - Sending signals to workflows
 * - Querying workflow status
 * - Managing workflow lifecycle
 */
export class WorkflowEngineService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly registry = $inject(WorkflowRegistryService);
  protected readonly queues = $inject(WorkflowQueues);
  protected readonly executions = $repository(workflowExecutionEntity);
  protected readonly events = $repository(workflowEventEntity);
  protected readonly signals = $repository(workflowSignalQueueEntity);

  /**
   * Start a new workflow execution.
   */
  public async start<TInput, TOutput>(
    workflow: Workflow<any, TOutput>,
    input: TInput,
  ): Promise<WorkflowExecutionInfo> {
    const workflowId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const now = this.dateTime.nowISOString();

    // Create workflow execution record
    const execution = await this.executions.create({
      workflowId,
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      runId,
      status: "running",
      input: input as any,
      state: {},
      startedAt: now,
      updatedAt: now,
    });

    // Create WorkflowStarted event
    await this.events.create({
      eventId: crypto.randomUUID(),
      workflowId,
      sequence: 1,
      eventType: "WorkflowStarted",
      eventData: { input, timestamp: now },
      timestamp: now,
    });

    // Dispatch workflow execution to background queue
    await this.queues.executeWorkflow.push({ workflowId });

    return {
      workflowId: execution.workflowId,
      status: execution.status,
      startedAt: execution.startedAt,
    };
  }

  /**
   * Send a signal to a running workflow.
   */
  public async signal<T>(
    workflowId: string,
    signal: Atom<any> | string,
    payload: T,
  ): Promise<void> {
    const signalName = typeof signal === "string" ? signal : signal.key;

    // Check if workflow exists and is running
    const execution = await this.executions.findOne({ where: { workflowId } });
    if (!execution) {
      throw new AlephaError(`Workflow ${workflowId} not found`);
    }

    if (execution.status !== "running") {
      throw new AlephaError(
        `Workflow ${workflowId} is not running (status: ${execution.status})`,
      );
    }

    // Queue the signal
    await this.signals.create({
      signalId: crypto.randomUUID(),
      workflowId,
      signalName,
      payload: payload as any,
      receivedAt: this.dateTime.nowISOString(),
    });

    // Trigger workflow execution to process the signal
    await this.queues.executeWorkflow.push({ workflowId });
  }

  /**
   * Get workflow execution status.
   */
  public async getStatus(workflowId: string): Promise<WorkflowExecutionInfo | null> {
    const execution = await this.executions.findOne({ where: { workflowId } });
    if (!execution) {
      return null;
    }

    return {
      workflowId: execution.workflowId,
      workflowName: execution.workflowName,
      status: execution.status,
      input: execution.input,
      output: execution.output,
      error: execution.error ?? undefined,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt ?? undefined,
    };
  }

  /**
   * Cancel a running workflow.
   */
  public async cancel(workflowId: string): Promise<void> {
    const execution = await this.executions.findOne({ where: { workflowId } });
    if (!execution) {
      throw new AlephaError(`Workflow ${workflowId} not found`);
    }

    if (execution.status !== "running") {
      throw new AlephaError(
        `Cannot cancel workflow ${workflowId} in status ${execution.status}`,
      );
    }

    const now = this.dateTime.nowISOString();
    await this.executions.updateOne(
      { workflowId },
      {
        status: "canceled",
        completedAt: now,
        updatedAt: now,
      },
    );

    // Create WorkflowCanceled event
    const sequence = await this.getNextSequence(workflowId);
    await this.events.create({
      eventId: crypto.randomUUID(),
      workflowId,
      sequence,
      eventType: "WorkflowCanceled",
      eventData: { timestamp: now },
      timestamp: now,
    });
  }

  /**
   * Get workflow event history.
   */
  public async getEvents(workflowId: string): Promise<any[]> {
    const events = await this.events.findMany({
      where: { workflowId },
    });

    return events.map((e) => ({
      eventId: e.eventId,
      sequence: e.sequence,
      eventType: e.eventType,
      eventData: e.eventData,
      timestamp: e.timestamp,
    }));
  }

  /**
   * Get next event sequence number for a workflow.
   */
  private async getNextSequence(workflowId: string): Promise<number> {
    const lastEvent = await this.events.findOne({
      where: { workflowId },
    });

    return (lastEvent?.sequence ?? 0) + 1;
  }
}

export interface WorkflowExecutionInfo {
  workflowId: string;
  workflowName?: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
