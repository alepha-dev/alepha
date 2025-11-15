import { $inject, Alepha } from "@alepha/core";
import { $repository } from "@alepha/orm";
import { $job } from "../descriptors/$job.ts";
import { jobExecutions } from "../entities/jobExecutions.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";

export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly executionRepository = $repository(jobExecutions);

  public async getJobs(): Promise<string[]> {
    const jobDescriptors = this.alepha.descriptors($job);
    return jobDescriptors.map((job) => job.name);
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

  public async triggerJob(name: string): Promise<{ ok: boolean }> {
    const jobDescriptors = this.alepha.descriptors($job);
    const job = jobDescriptors.find((j) => j.name === name);

    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    await job.trigger();
    return { ok: true };
  }
}
