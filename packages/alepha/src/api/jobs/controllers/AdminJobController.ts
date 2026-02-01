import { $inject, Alepha, t } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { $action, okSchema } from "alepha/server";
import { jobExecutionQuerySchema } from "../schemas/jobExecutionQuerySchema.ts";
import { jobExecutionResourceSchema } from "../schemas/jobExecutionResourceSchema.ts";
import { triggerJobSchema } from "../schemas/triggerJobSchema.ts";
import { JobAudits } from "../services/JobAudits.ts";
import { JobService } from "../services/JobService.ts";

export class AdminJobController {
  protected readonly url: string = "/jobs";
  protected readonly group: string = "admin:jobs";
  protected readonly alepha = $inject(Alepha);
  protected readonly jobService = $inject(JobService);

  public readonly getJobs = $action({
    path: this.url,
    group: this.group,
    secure: true,
    schema: {
      response: t.array(t.string()),
    },
    handler: () => this.jobService.getJobs(),
  });

  public readonly getJobExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    secure: true,
    schema: {
      query: jobExecutionQuerySchema,
      response: t.page(jobExecutionResourceSchema),
    },
    handler: ({ query }) => this.jobService.getJobExecutions(query),
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
    handler: async ({ body }) => {
      const result = await this.jobService.triggerJob(body.name);

      // Audit the manual trigger if audits are enabled
      if (this.alepha.has(AlephaApiAudits)) {
        const jobAudits = this.alepha.inject(JobAudits);
        await jobAudits.logTrigger(body.name);
      }

      return result;
    },
  });
}
