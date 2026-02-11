import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import {
  jobActivityPointSchema,
  jobActivityQuerySchema,
} from "../schemas/jobActivitySchema.ts";
import { jobCronInfoSchema } from "../schemas/jobCronInfoSchema.ts";
import { jobExecutionDetailResourceSchema } from "../schemas/jobExecutionDetailResourceSchema.ts";
import { jobExecutionQuerySchema } from "../schemas/jobExecutionQuerySchema.ts";
import { jobExecutionResourceSchema } from "../schemas/jobExecutionResourceSchema.ts";
import { jobFailureSchema } from "../schemas/jobFailureSchema.ts";
import { jobQueueDepthSchema } from "../schemas/jobQueueDepthSchema.ts";
import { jobRegistrationSchema } from "../schemas/jobRegistrationSchema.ts";
import { jobStatsSchema } from "../schemas/jobStatsSchema.ts";
import { triggerJobSchema } from "../schemas/triggerJobSchema.ts";
import { JobService } from "../services/JobService.ts";

export class AdminJobController {
  protected readonly url: string = "/jobs";
  protected readonly group: string = "admin:jobs";
  protected readonly jobService = $inject(JobService);

  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    secure: true,
    schema: {
      response: jobStatsSchema,
    },
    handler: () => this.jobService.getStats(),
  });

  public readonly getRegistry = $action({
    path: this.url,
    group: this.group,
    secure: true,
    schema: {
      response: t.array(jobRegistrationSchema),
    },
    handler: () => this.jobService.getRegistry(),
  });

  public readonly findExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    secure: true,
    schema: {
      query: jobExecutionQuerySchema,
      response: t.page(jobExecutionResourceSchema),
    },
    handler: ({ query }) => this.jobService.findExecutions(query),
  });

  public readonly getExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    secure: true,
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: jobExecutionDetailResourceSchema,
    },
    handler: ({ params }) => this.jobService.getExecution(params.id),
  });

  public readonly triggerJob = $action({
    method: "POST",
    path: `${this.url}/trigger`,
    group: this.group,
    secure: true,
    schema: {
      body: triggerJobSchema,
      response: okSchema,
    },
    handler: async ({ body, user }) => {
      return this.jobService.triggerJob(body.name, {
        payload: body.payload,
        triggeredBy: user?.id,
        triggeredByName: user?.name,
      });
    },
  });

  public readonly retryExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    secure: true,
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      return this.jobService.retryExecution(params.id, {
        triggeredBy: user?.id,
        triggeredByName: user?.name,
      });
    },
  });

  public readonly cancelExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    secure: true,
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      return this.jobService.cancelExecution(params.id, {
        cancelledBy: user?.id,
        cancelledByName: user?.name,
      });
    },
  });

  public readonly getActivity = $action({
    path: `${this.url}/activity`,
    group: this.group,
    secure: true,
    schema: {
      query: jobActivityQuerySchema,
      response: t.array(jobActivityPointSchema),
    },
    handler: ({ query }) => this.jobService.getActivity(query.days),
  });

  public readonly getCronJobs = $action({
    path: `${this.url}/cron`,
    group: this.group,
    secure: true,
    schema: {
      response: t.array(jobCronInfoSchema),
    },
    handler: () => this.jobService.getCronJobs(),
  });

  public readonly getQueueDepth = $action({
    path: `${this.url}/queue`,
    group: this.group,
    secure: true,
    schema: {
      response: t.array(jobQueueDepthSchema),
    },
    handler: () => this.jobService.getQueueDepth(),
  });

  public readonly getTopFailures = $action({
    path: `${this.url}/failures`,
    group: this.group,
    secure: true,
    schema: {
      response: t.array(jobFailureSchema),
    },
    handler: () => this.jobService.getTopFailures(),
  });
}
