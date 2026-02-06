import { $env, $inject, Alepha, type Async, type Static, t } from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $lock, type LockPrimitive } from "alepha/lock";
import type { LogEntry } from "alepha/logger";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import {
  type JobExecutionEntity,
  jobExecutions,
} from "../entities/jobExecutions.ts";

const envSchema = t.object({
  JOB_PREFIX: t.optional(
    t.text({
      description: "Prefix for job lock keys",
    }),
  ),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Provider for job management and execution.
 * Handles job lifecycle, execution tracking, log capturing, and event emission.
 */
export class JobProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cronProvider = $inject(CronProvider);
  protected readonly executionRepository = $repository(jobExecutions);
  protected readonly env = $env(envSchema);
  protected readonly logs = new Map<string, LogEntry[]>();
  protected readonly jobs = new Map<string, JobRegistration>();
  protected readonly pendingContext = new Map<string, JobTriggerContext[]>();

  /**
   * Register and set up a job for execution (called during primitive initialization).
   */
  public registerJob(options: Job): JobRegistration {
    const jobName = options.name;

    // Set up log capturing for this job (only once)
    if (this.jobs.size === 0) {
      this.alepha.events.on("log", ({ entry }) => {
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
      });
    }

    // Create lock primitive if locking is enabled
    const lockPrimitive =
      options.lock !== false
        ? $lock({
            name: () => {
              const prefix = this.env.JOB_PREFIX
                ? `${this.env.JOB_PREFIX}:`
                : "";
              return `${prefix}job:${jobName}`;
            },
            handler: async () => {
              const ctx = this.pendingContext.get(jobName)?.shift();
              await this.executeJob(jobName, options.handler, ctx);
            },
          })
        : null;

    const registration: JobRegistration = {
      name: jobName,
      options,
      lockPrimitive,
    };

    this.jobs.set(jobName, registration);

    // Set up cron scheduling if provided
    if (options.cron) {
      this.cronProvider.createCronJob(jobName, options.cron, () =>
        this.triggerJob(jobName),
      );
    }

    return registration;
  }

  /**
   * Trigger a job by name.
   */
  public async triggerJob(
    jobName: string,
    context?: JobTriggerContext,
  ): Promise<void> {
    const registration = this.jobs.get(jobName);
    if (!registration) {
      throw new Error(`Job not registered: ${jobName}`);
    }

    // Queue context for the lock handler path
    if (context) {
      const queue = this.pendingContext.get(jobName) ?? [];
      queue.push(context);
      this.pendingContext.set(jobName, queue);
    }

    try {
      // Execute handler with or without lock
      if (registration.options.lock !== false && registration.lockPrimitive) {
        await registration.lockPrimitive.run();
      } else {
        await this.executeJob(jobName, registration.options.handler, context);
      }
    } finally {
      // Clean up queue if empty
      const queue = this.pendingContext.get(jobName);
      if (queue && queue.length === 0) {
        this.pendingContext.delete(jobName);
      }
    }
  }

  /**
   * Execute a job handler (called by the job primitive).
   */
  public async executeJob(
    jobName: string,
    handler: (args: { now: DateTime }) => Async<void>,
    triggerContext?: JobTriggerContext,
  ): Promise<void> {
    if (!this.alepha.isStarted()) {
      return;
    }

    const context = this.alepha.context.createContextId();

    await this.alepha.context.run(
      async () => {
        let execution: JobExecutionEntity | undefined;

        try {
          const now = this.dateTimeProvider.now();

          // Initialize log collection for this context
          this.logs.set(context, []);

          // Create execution record and capture its ID
          execution = await this.executionRepository.create({
            job: jobName,
            status: "STARTED",
            triggeredBy: triggerContext?.triggeredBy,
            triggeredByName: triggerContext?.triggeredByName,
          });

          await this.alepha.events.emit("scheduler:begin", {
            name: jobName,
            now,
            context,
          });

          // Execute the handler
          await handler({ now });

          // Update execution as completed
          const logs = this.logs.get(context) || [];

          execution.status = "COMPLETED";
          execution.logs = logs;
          execution.finishedAt = this.dateTimeProvider.nowISOString();

          await this.executionRepository.save(execution);

          await this.alepha.events.emit(
            "scheduler:success",
            {
              name: jobName,
              context,
            },
            {
              catch: true,
            },
          );
        } catch (error) {
          // Update execution as failed (only if we have a record)
          if (execution) {
            const logs = this.logs.get(context) || [];

            execution.status = "FAILED";
            execution.error = (error as Error).message;
            execution.logs = logs;
            execution.finishedAt = this.dateTimeProvider.nowISOString();

            await this.executionRepository.save(execution);
          }

          await this.alepha.events.emit(
            "scheduler:error",
            {
              name: jobName,
              error: error as Error,
              context,
            },
            {
              catch: true,
            },
          );

          // Don't re-throw, jobs should handle errors gracefully
        }

        // Clean up logs
        this.logs.delete(context);

        await this.alepha.events.emit(
          "scheduler:end",
          {
            name: jobName,
            context,
          },
          {
            catch: true,
          },
        );
      },
      {
        context,
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Job {
  /**
   * Name of the job.
   */
  name: string;

  /**
   * Optional description of the job.
   */
  description?: string;

  /**
   * Function to run on schedule.
   */
  handler: (args: { now: DateTime }) => Async<void>;

  /**
   * Cron expression to run the job.
   */
  cron?: string;

  /**
   * If true, the job will be locked and only one instance will run at a time.
   * You probably need to import {@link AlephaLockRedis} for distributed locking.
   *
   * @default true
   */
  lock?: boolean;
}

export interface JobRegistration {
  name: string;
  options: Job;
  lockPrimitive: LockPrimitive<() => Promise<void>> | null;
}

export interface JobTriggerContext {
  /**
   * ID of the user who triggered the job.
   */
  triggeredBy?: string;

  /**
   * Display name of the user who triggered the job.
   */
  triggeredByName?: string;
}
