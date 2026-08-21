import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { jobExecutionQuerySchema } from "../schemas/jobExecutionQuerySchema.ts";
import { jobExecutionResourceSchema } from "../schemas/jobExecutionResourceSchema.ts";
import { jobRegistrationSchema } from "../schemas/jobRegistrationSchema.ts";
import { triggerJobSchema } from "../schemas/triggerJobSchema.ts";
import { JobService } from "../services/JobService.ts";

/**
 * Minimal admin surface for the job system. Six endpoints.
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
      response: z.array(jobExecutionResourceSchema),
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
}
