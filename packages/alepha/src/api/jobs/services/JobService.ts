import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";
import { jobExecutions } from "../entities/jobExecutions.ts";
import { $job } from "../primitives/$job.ts";
import type { JobTriggerContext } from "../providers/JobProvider.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";

export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly executionRepository = $repository(jobExecutions);

  public async getJobs(): Promise<string[]> {
    const jobPrimitives = this.alepha.primitives($job);
    return jobPrimitives.map((job) => job.name);
  }

  public async getJobExecutions(query: JobExecutionQuery = {}) {
    query.sort ??= "-createdAt";

    const where = this.executionRepository.createQueryWhere();

    if (query.job) {
      where.job = { eq: query.job };
    }

    if (query.status) {
      where.status = { eq: query.status };
    }

    return await this.executionRepository.paginate(
      query,
      { where },
      { count: true },
    );
  }

  public async triggerJob(
    name: string,
    context?: JobTriggerContext,
  ): Promise<{ ok: boolean }> {
    const jobPrimitives = this.alepha.primitives($job);
    const job = jobPrimitives.find((j) => j.name === name);

    if (!job) {
      throw new NotFoundError(`Job not found: ${name}`);
    }

    await job.trigger(context);
    return { ok: true };
  }
}
