import { $action } from "../../server/descriptors/$action.ts";
import { $inject } from "../../core/descriptors/$inject.ts";
import { t } from "../../core/providers/TypeProvider.ts";
import { AlephaError } from "../../core/errors/AlephaError.ts";
import { WorkflowEngineService } from "../services/WorkflowEngineService.ts";
import { WorkflowRegistryService } from "../services/WorkflowRegistryService.ts";

/**
 * HTTP API for workflow management.
 *
 * Provides endpoints for:
 * - Starting workflow executions
 * - Sending signals to workflows
 * - Querying workflow status
 * - Listing workflows and activities
 */
export class WorkflowController {
  protected readonly engine = $inject(WorkflowEngineService);
  protected readonly registry = $inject(WorkflowRegistryService);

  /**
   * Start a new workflow execution.
   *
   * POST /workflows/:name/start
   */
  public readonly startWorkflow = $action({
    method: "POST",
    path: "/workflows/:name/start",
    schema: {
      params: t.object({
        name: t.text({ description: "Workflow name" }),
      }),
      query: t.object({
        version: t.optional(t.text({ description: "Workflow version" })),
      }),
      body: t.object({
        input: t.json({ description: "Workflow input data" }),
      }),
      response: t.object({
        workflowId: t.text(),
        status: t.text(),
        startedAt: t.text(),
      }),
    },
    handler: async ({ params, query, body }) => {
      const workflow = this.registry.getWorkflow(params.name, query.version);
      if (!workflow) {
        throw new AlephaError(
          `Workflow ${params.name} version ${query.version ?? "1"} not found`,
        );
      }

      const execution = await this.engine.start(workflow, body.input);

      return {
        workflowId: execution.workflowId,
        status: execution.status,
        startedAt: execution.startedAt,
      };
    },
  });

  /**
   * Send a signal to a running workflow.
   *
   * POST /workflows/:workflowId/signals/:signalName
   */
  public readonly sendSignal = $action({
    method: "POST",
    path: "/workflows/:workflowId/signals/:signalName",
    schema: {
      params: t.object({
        workflowId: t.uuid({ description: "Workflow execution ID" }),
        signalName: t.text({ description: "Signal name" }),
      }),
      body: t.object({
        payload: t.json({ description: "Signal payload data" }),
      }),
      response: t.object({
        sent: t.boolean(),
        workflowId: t.text(),
        signalName: t.text(),
      }),
    },
    handler: async ({ params, body }) => {
      await this.engine.signal(params.workflowId, params.signalName, body.payload);

      return {
        sent: true,
        workflowId: params.workflowId,
        signalName: params.signalName,
      };
    },
  });

  /**
   * Get workflow execution status.
   *
   * GET /workflows/:workflowId
   */
  public readonly getWorkflowStatus = $action({
    method: "GET",
    path: "/workflows/:workflowId",
    schema: {
      params: t.object({
        workflowId: t.uuid({ description: "Workflow execution ID" }),
      }),
      response: t.object({
        workflowId: t.text(),
        workflowName: t.optional(t.text()),
        status: t.text(),
        input: t.optional(t.json()),
        output: t.optional(t.json()),
        error: t.optional(t.text()),
        startedAt: t.text(),
        completedAt: t.optional(t.text()),
      }),
    },
    handler: async ({ params }) => {
      const status = await this.engine.getStatus(params.workflowId);
      if (!status) {
        throw new AlephaError(`Workflow ${params.workflowId} not found`);
      }

      return status;
    },
  });

  /**
   * Get workflow event history.
   *
   * GET /workflows/:workflowId/events
   */
  public readonly getWorkflowEvents = $action({
    method: "GET",
    path: "/workflows/:workflowId/events",
    schema: {
      params: t.object({
        workflowId: t.uuid({ description: "Workflow execution ID" }),
      }),
      response: t.object({
        workflowId: t.text(),
        events: t.array(t.json()),
      }),
    },
    handler: async ({ params }) => {
      const events = await this.engine.getEvents(params.workflowId);

      return {
        workflowId: params.workflowId,
        events,
      };
    },
  });

  /**
   * Cancel a running workflow.
   *
   * POST /workflows/:workflowId/cancel
   */
  public readonly cancelWorkflow = $action({
    method: "POST",
    path: "/workflows/:workflowId/cancel",
    schema: {
      params: t.object({
        workflowId: t.uuid({ description: "Workflow execution ID" }),
      }),
      response: t.object({
        workflowId: t.text(),
        canceled: t.boolean(),
      }),
    },
    handler: async ({ params }) => {
      await this.engine.cancel(params.workflowId);

      return {
        workflowId: params.workflowId,
        canceled: true,
      };
    },
  });

  /**
   * List all registered workflows.
   *
   * GET /workflows
   */
  public readonly listWorkflows = $action({
    method: "GET",
    path: "/workflows",
    schema: {
      response: t.object({
        workflows: t.array(
          t.object({
            name: t.text(),
            version: t.text(),
            description: t.optional(t.text()),
          }),
        ),
      }),
    },
    handler: async () => {
      const workflows = this.registry.listWorkflows();

      return {
        workflows: workflows.map((w) => ({
          name: w.name,
          version: w.version,
          description: w.options.description,
        })),
      };
    },
  });

  /**
   * List all registered activities.
   *
   * GET /activities
   */
  public readonly listActivities = $action({
    method: "GET",
    path: "/activities",
    schema: {
      response: t.object({
        activities: t.array(
          t.object({
            name: t.text(),
            description: t.optional(t.text()),
          }),
        ),
      }),
    },
    handler: async () => {
      const activities = this.registry.listActivities();

      return {
        activities: activities.map((a) => ({
          name: a.name,
          description: a.options.description,
        })),
      };
    },
  });
}
