import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { workflowActivityQuerySchema } from "../schemas/workflowActivityQuerySchema.ts";
import { workflowActivityPointSchema } from "../schemas/workflowActivitySchema.ts";
import { workflowExecutionDetailSchema } from "../schemas/workflowExecutionDetailSchema.ts";
import { workflowExecutionQuerySchema } from "../schemas/workflowExecutionQuerySchema.ts";
import { workflowExecutionResourceSchema } from "../schemas/workflowExecutionResourceSchema.ts";
import { workflowRegistrationSchema } from "../schemas/workflowRegistrationSchema.ts";
import { workflowStatsSchema } from "../schemas/workflowStatsSchema.ts";
import { WorkflowService } from "../services/WorkflowService.ts";

/**
 * Admin surface for the workflow engine.
 */
export class AdminWorkflowController {
  protected readonly url: string = "/workflows";
  protected readonly group: string = "admin:workflows";
  protected readonly workflowService = $inject(WorkflowService);

  public readonly getWorkflowRegistry = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      response: z.array(workflowRegistrationSchema),
    },
    handler: () => this.workflowService.getWorkflowRegistry(),
  });

  public readonly getWorkflowStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowActivityQuerySchema,
      response: workflowStatsSchema,
    },
    handler: ({ query }) => this.workflowService.getStats(query.days),
  });

  public readonly getWorkflowActivity = $action({
    path: `${this.url}/activity`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowActivityQuerySchema,
      response: z.array(workflowActivityPointSchema),
    },
    handler: ({ query }) => this.workflowService.getActivity(query.days),
  });

  public readonly findWorkflowExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowExecutionQuerySchema,
      response: z.page(workflowExecutionResourceSchema),
    },
    handler: ({ query }) => this.workflowService.findWorkflowExecutions(query),
  });

  public readonly getWorkflowExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: workflowExecutionDetailSchema,
    },
    handler: ({ params }) => this.workflowService.getExecution(params.id),
  });

  public readonly startWorkflow = $action({
    method: "POST",
    path: `${this.url}/start`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:create"] })],
    schema: {
      body: z.object({
        name: z.text(),
        payload: z.record(z.text(), z.any()).optional(),
        key: z.text().optional(),
        tags: z.array(z.text()).optional(),
      }),
      response: z.object({ id: z.uuid() }),
    },
    handler: async ({ body, user }) => {
      return this.workflowService.triggerWorkflow(body.name, body.payload, {
        key: body.key,
        tags: body.tags,
        triggeredBy: user?.id,
        triggeredByName: user?.name,
      });
    },
  });

  public readonly cancelWorkflowExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      return this.workflowService.cancelWorkflowExecution(params.id, {
        cancelledBy: user?.id,
        cancelledByName: user?.name,
      });
    },
  });

  public readonly retryWorkflowExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      return this.workflowService.retryWorkflowExecution(params.id);
    },
  });

  public readonly restartWorkflowExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/restart`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:create"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ id: z.uuid() }),
    },
    handler: async ({ params }) => {
      return this.workflowService.restartWorkflowExecution(params.id);
    },
  });

  public readonly compensateWorkflowExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/compensate`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      return this.workflowService.compensateWorkflowExecution(params.id);
    },
  });
}
