import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { jobExecutionQuerySchema } from "../schemas/jobExecutionQuerySchema.ts";
import { jobExecutionResourceSchema } from "../schemas/jobExecutionResourceSchema.ts";
import { jobExecutionRowSchema } from "../schemas/jobExecutionRowSchema.ts";
import { jobRegistrationSchema } from "../schemas/jobRegistrationSchema.ts";
import { triggerJobSchema } from "../schemas/triggerJobSchema.ts";
import { JobService } from "../services/JobService.ts";

/**
 * Admin surface for the job system: list jobs, page and read executions,
 * trigger, retry, cancel and delete.
 */
export class AdminJobController {
  protected readonly url: string = "/jobs";
  protected readonly group: string = "admin:jobs";
  protected readonly jobService = $inject(JobService);

  public readonly listJobs = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:read"] })],
    schema: {
      response: z.array(jobRegistrationSchema),
    },
    handler: () => this.jobService.listJobs(),
  });

  public readonly listExecutions = $action({
    path: `${this.url}/:name/executions`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:read"] })],
    schema: {
      params: z.object({ name: z.text() }),
      query: jobExecutionQuerySchema,
      response: z.page(jobExecutionRowSchema),
    },
    handler: ({ params, query }) =>
      this.jobService.getExecutions(params.name, query),
  });

  public readonly getExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: jobExecutionResourceSchema,
    },
    handler: ({ params }) => this.jobService.getExecution(params.id),
  });

  public readonly triggerJob = $action({
    method: "POST",
    path: `${this.url}/:name/trigger`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:trigger"] })],
    schema: {
      params: z.object({ name: z.text() }),
      body: triggerJobSchema,
      response: okSchema,
    },
    handler: ({ params, body, user }) =>
      this.jobService.triggerJob(params.name, {
        payload: body.payload,
        triggeredBy: user?.id,
        triggeredByName: user?.name,
      }),
  });

  public readonly retryExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:trigger"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.jobService.retryExecution(params.id, {
        triggeredBy: user?.id,
        triggeredByName: user?.name,
      }),
  });

  public readonly cancelExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:cancel"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.jobService.cancelExecution(params.id, {
        cancelledBy: user?.id,
        cancelledByName: user?.name,
      }),
  });

  /**
   * Delete one finished execution. A pending, scheduled or running one is
   * refused with a 409 that says to cancel it first.
   */
  public readonly deleteExecution = $action({
    method: "DELETE",
    path: `${this.url}/executions/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:delete"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.jobService.deleteExecution(params.id, {
        deletedBy: user?.id,
        deletedByName: user?.name,
      }),
  });

  /**
   * Delete the finished executions among `ids` and skip the others, answering
   * how many of each.
   */
  public readonly deleteExecutions = $action({
    method: "POST",
    path: `${this.url}/executions/delete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:job:delete"] })],
    schema: {
      body: z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
      response: z.object({ deleted: z.integer(), skipped: z.integer() }),
    },
    handler: ({ body, user }) =>
      this.jobService.deleteExecutions(body.ids, {
        deletedBy: user?.id,
        deletedByName: user?.name,
      }),
  });
}
