import {
  $env,
  $inject,
  Alepha,
  type Async,
  createDescriptor,
  Descriptor,
  KIND,
  type Static,
  t,
} from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import { $lock } from "@alepha/lock";
import type { LogEntry } from "@alepha/logger";
import { $logger } from "@alepha/logger";
import { $repository } from "@alepha/postgres";
import { CronProvider } from "@alepha/scheduler";
import { jobExecutions } from "../entities/jobExecutions.ts";

/**
 * Job descriptor - a drop-in replacement for $scheduler with built-in execution tracking.
 */
export const $job = (options: JobDescriptorOptions): JobDescriptor => {
  return createDescriptor(JobDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type JobDescriptorOptions = {
  /**
   * Function to run on schedule.
   */
  handler: (args: JobHandlerArguments) => Async<void>;

  /**
   * Name of the job. Defaults to the function name.
   */
  name?: string;

  /**
   * Optional description of the job.
   */
  description?: string;

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
};

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  JOB_PREFIX: t.optional(
    t.text({
      description: "Prefix for job lock keys",
    }),
  ),
});

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class JobDescriptor extends Descriptor<JobDescriptorOptions> {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cronProvider = $inject(CronProvider);
  protected readonly executionRepository = $repository(jobExecutions);
  protected readonly logs = new Map<string, LogEntry[]>();

  public get name(): string {
    return (
      this.options.name ??
      `${this.config.service.name}.${this.config.propertyKey}`
    );
  }

  protected onInit() {
    // Set up log capturing
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

    if (this.options.cron) {
      this.cronProvider.createCronJob(this.name, this.options.cron, () =>
        this.trigger(),
      );
    }
  }

  public async trigger(): Promise<void> {
    if (!this.alepha.isStarted()) {
      return;
    }

    const context = this.alepha.context.createContextId();

    await this.alepha.context.run(
      async () => {
        try {
          const now = this.dateTimeProvider.now();

          // Initialize log collection for this context
          this.logs.set(context, []);

          // Create execution record
          await this.executionRepository.create({
            job: this.name,
            status: "STARTED",
          });

          await this.alepha.events.emit("scheduler:begin", {
            name: this.name,
            now,
            context,
          });

          if (this.options.lock !== false) {
            await this.jobLock.run({ now });
          } else {
            await this.options.handler({ now });
          }

          // Update execution as completed
          const logs = this.logs.get(context) || [];
          const exec = await this.executionRepository.findOne({
            where: {
              job: this.name,
              status: "STARTED",
            },
          });

          exec.status = "COMPLETED";
          exec.logs = logs;
          exec.finishedAt = this.dateTimeProvider.now();

          await this.executionRepository.save(exec);

          await this.alepha.events.emit(
            "scheduler:success",
            {
              name: this.name,
              context,
            },
            {
              catch: true,
            },
          );
        } catch (error) {
          // Update execution as failed
          const logs = this.logs.get(context) || [];
          const exec = await this.executionRepository.findOne({
            where: {
              job: this.name,
              status: "STARTED",
            },
          });

          exec.status = "FAILED";
          exec.error = (error as Error).message;
          exec.logs = logs;
          exec.finishedAt = this.dateTimeProvider.now();

          await this.executionRepository.save(exec);

          await this.alepha.events.emit(
            "scheduler:error",
            {
              name: this.name,
              error: error as Error,
              context,
            },
            {
              catch: true,
            },
          );

          this.log.error("Error running job:", error);
        }

        // Clean up logs
        this.logs.delete(context);

        await this.alepha.events.emit(
          "scheduler:end",
          {
            name: this.name,
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

  protected jobLock = $lock({
    name: () => {
      const prefix = this.env.JOB_PREFIX ? `${this.env.JOB_PREFIX}:` : "";
      return `${prefix}job:${this.name}`;
    },
    handler: async (args: JobHandlerArguments) => {
      await this.options.handler(args);
    },
  });
}

$job[KIND] = JobDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface JobHandlerArguments {
  now: DateTime;
}
