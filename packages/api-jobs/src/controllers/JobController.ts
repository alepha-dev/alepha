import "@alepha/server-security";
import { $inject, t } from "@alepha/core";
import { pg } from "@alepha/postgres";
import { $action, okSchema } from "@alepha/server";
import { jobExecutionQuerySchema } from "../schemas/jobExecutionQuerySchema.ts";
import { jobExecutionResourceSchema } from "../schemas/jobExecutionResourceSchema.ts";
import { triggerJobSchema } from "../schemas/triggerJobSchema.ts";
import { JobService } from "../services/JobService.ts";

export class JobController {
	protected readonly url = "/jobs";
	protected readonly group = "jobs";
	protected readonly jobService = $inject(JobService);

	public readonly getJobs = $action({
		path: this.url,
		group: this.group,
		schema: {
			response: t.array(t.string()),
		},
		handler: () => this.jobService.getJobs(),
	});

	public readonly getJobExecutions = $action({
		path: `${this.url}/executions`,
		group: this.group,
		schema: {
			query: jobExecutionQuerySchema,
			response: pg.page(jobExecutionResourceSchema),
		},
		handler: ({ query }) => this.jobService.getJobExecutions(query),
	});

	public readonly triggerJob = $action({
		method: "POST",
		path: `${this.url}/trigger`,
		group: this.group,
		schema: {
			body: triggerJobSchema,
			response: okSchema,
		},
		handler: ({ body }) => this.jobService.triggerJob(body.name),
	});
}
