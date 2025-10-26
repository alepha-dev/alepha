import "@alepha/scheduler";
import { $hook, $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import type { LogEntry } from "@alepha/logger";
import { $repository } from "@alepha/postgres";
import { $scheduler } from "@alepha/scheduler";
import { jobExecutions } from "../entities/jobExecutions.ts";
import type { JobExecutionQuery } from "../schemas/jobExecutionQuerySchema.ts";

export class JobService {
  protected readonly alepha = $inject(Alepha);
  protected readonly executionRepository = $repository(jobExecutions);
  protected readonly dtp = $inject(DateTimeProvider);
  protected readonly logs = new Map<string, LogEntry[]>();

  protected readonly onLogs = $hook({
    on: "log",
    handler: async ({ entry }) => {
      const context = entry.context;
      if (!context) {
        return;
      }

      const entries = this.logs.get(context);
      if (!entries) {
        return;
      }

      entries.push(entry);

      this.logs.set(context, entries);
    },
  });

  protected readonly onSchedulerBegin = $hook({
    on: "scheduler:begin",
    handler: async ({ name, context }) => {
      await this.executionRepository.create({
        job: name,
        status: "STARTED",
      });
      this.logs.set(context, []);
    },
  });

  protected readonly onSchedulerError = $hook({
    on: "scheduler:error",
    handler: async ({ name, error, context }) => {
      const logs = this.logs.get(context) || [];
      const exec = await this.executionRepository.findOne({
        where: {
          job: name,
          status: "STARTED",
        },
      });

      exec.status = "FAILED";
      exec.error = error.message;
      exec.logs = logs;
      exec.finishedAt = this.dtp.now();

      await this.executionRepository.save(exec);
    },
  });

  public readonly onSchedulerSuccess = $hook({
    on: "scheduler:success",
    handler: async ({ name, context }) => {
      const logs = this.logs.get(context) || [];
      const exec = await this.executionRepository.findOne({
        where: {
          job: name,
          status: "STARTED",
        },
      });

      exec.status = "COMPLETED";
      exec.logs = logs;
      exec.finishedAt = this.dtp.now();

      await this.executionRepository.save(exec);
    },
  });

  public readonly onSchedulerEnd = $hook({
    on: "scheduler:end",
    handler: async ({ context }) => {
      this.logs.delete(context);
    },
  });

  public async getJobs(): Promise<string[]> {
    const schedulerDescriptors = this.alepha.descriptors($scheduler);
    return schedulerDescriptors.map((scheduler) => scheduler.name);
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
    const schedulerDescriptors = this.alepha.descriptors($scheduler);
    const scheduler = schedulerDescriptors.find((s) => s.name === name);

    if (!scheduler) {
      throw new Error(`Job not found: ${name}`);
    }

    await scheduler.trigger();
    return { ok: true };
  }
}
