import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import {
  workflowActivityPointSchema,
  workflowActivityQuerySchema,
} from "../schemas/workflowActivitySchema.ts";
import { workflowExecutionDetailSchema } from "../schemas/workflowExecutionDetailSchema.ts";
import { workflowExecutionQuerySchema } from "../schemas/workflowExecutionQuerySchema.ts";
import { workflowExecutionResourceSchema } from "../schemas/workflowExecutionResourceSchema.ts";
import { workflowRegistrationSchema } from "../schemas/workflowRegistrationSchema.ts";
import { workflowStatsSchema } from "../schemas/workflowStatsSchema.ts";
import { WorkflowService } from "../services/WorkflowService.ts";

export class AdminWorkflowController {
  protected readonly url: string = "/workflows";
  protected readonly group: string = "admin:workflows";
  protected readonly workflowService = $inject(WorkflowService);

  public readonly getRegistry = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      response: t.array(workflowRegistrationSchema),
    },
    handler: () => this.workflowService.getRegistry(),
  });

  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowActivityQuerySchema,
      response: workflowStatsSchema,
    },
    handler: ({ query }) => this.workflowService.getStats(query.days),
  });

  public readonly getActivity = $action({
    path: `${this.url}/activity`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowActivityQuerySchema,
      response: t.array(workflowActivityPointSchema),
    },
    handler: ({ query }) => this.workflowService.getActivity(query.days),
  });

  public readonly findExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      query: workflowExecutionQuerySchema,
      response: t.page(workflowExecutionResourceSchema),
    },
    handler: ({ query }) => this.workflowService.findExecutions(query),
  });

  public readonly getExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:read"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
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
      body: t.object({
        name: t.text(),
        payload: t.optional(t.record(t.text(), t.any())),
        key: t.optional(t.text()),
        tags: t.optional(t.array(t.text())),
      }),
      response: t.object({ id: t.uuid() }),
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

  public readonly signalStep = $action({
    method: "POST",
    path: `${this.url}/executions/:id/signal`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      body: t.object({
        stepName: t.text(),
        payload: t.optional(t.record(t.text(), t.any())),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      return this.workflowService.signalExecution(
        params.id,
        body.stepName,
        body.payload,
        user?.id,
      );
    },
  });

  public readonly cancelExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      return this.workflowService.cancelExecution(params.id, {
        cancelledBy: user?.id,
        cancelledByName: user?.name,
      });
    },
  });

  public readonly retryExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      return this.workflowService.retryExecution(params.id);
    },
  });

  public readonly restartExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/restart`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:create"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: t.object({ id: t.uuid() }),
    },
    handler: async ({ params }) => {
      return this.workflowService.restartExecution(params.id);
    },
  });

  public readonly compensateExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/compensate`,
    group: this.group,
    use: [$secure({ permissions: ["admin:workflow:update"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      return this.workflowService.compensateExecution(params.id);
    },
  });
}
