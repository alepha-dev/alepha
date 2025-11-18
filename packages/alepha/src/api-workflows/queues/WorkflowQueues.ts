import { $inject, t } from "../../core/index.ts";
import { $queue } from "../../queue/descriptors/$queue.ts";
import { WorkflowExecutionService } from "../services/WorkflowExecutionService.ts";

/**
 * Background queues for workflow orchestration.
 *
 * Handles asynchronous workflow execution, including:
 * - Running workflow handlers
 * - Processing signals
 * - Executing activities
 * - Managing retries and timeouts
 */
export class WorkflowQueues {
  protected readonly workflowExecutionService = $inject(
    WorkflowExecutionService,
  );

  /**
   * Queue for executing workflow steps.
   *
   * This queue processes workflow executions asynchronously,
   * allowing workflows to run in the background without blocking API requests.
   */
  public readonly executeWorkflow = $queue({
    description: "Queue for executing workflow steps",
    schema: t.object({
      workflowId: t.uuid({ description: "Workflow execution ID to process" }),
    }),
    handler: async (message) => {
      await this.workflowExecutionService.executeStep(
        message.payload.workflowId,
      );
    },
  });
}
