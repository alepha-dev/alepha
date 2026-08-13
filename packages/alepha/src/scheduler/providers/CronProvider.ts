import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type Cron, parseCronExpression } from "cron-schedule";

export class CronProvider {
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly cronJobs: Array<CronJob> = [];

  public getCronJobs(): Array<CronJob> {
    return this.cronJobs;
  }

  protected readonly start = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isServerless()) {
        this.log.info("Ignoring cron jobs in serverless environment");
        return;
      }

      for (const cron of this.cronJobs) {
        if (!cron.running) {
          cron.running = true;
          this.log.debug(
            `Starting cron task '${cron.name}' with '${cron.expression}'`,
          );
          this.run(cron);
        }
      }
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: () => {
      for (const cron of this.cronJobs) {
        this.abort(cron);
      }
    },
  });

  /**
   * Generic serverless cron trigger. Vercel's platform-emitted entry
   * point fires `serverless:cron` with the job name; we run the matching
   * job in-process. On long-running runtimes this listener is harmless
   * (no one fires the event).
   */
  protected readonly onServerlessCron = $hook({
    on: "serverless:cron",
    handler: async ({ name }) => {
      await this.trigger(name);
    },
  });

  protected boot(name: string | CronJob) {
    const cron =
      typeof name === "string"
        ? this.cronJobs.find((c) => c.name === name)
        : name;

    if (!cron) {
      return;
    }

    // Same guard as the `start` hook — a job registered after start (e.g.
    // `createCronJob(..., start: true)`) must not spin up a timer loop in an
    // environment where the start hook refuses to.
    if (this.alepha.isServerless()) {
      this.log.debug(
        `Ignoring cron job '${cron.name}' in serverless environment`,
      );
      return;
    }

    cron.running = true;

    this.log.debug(
      `Starting cron task '${cron.name}' with '${cron.expression}'`,
    );

    this.run(cron);
  }

  public abort(name: string | CronJob): void {
    const cron =
      typeof name === "string"
        ? this.cronJobs.find((c) => c.name === name)
        : name;

    if (!cron?.running) {
      return;
    }

    cron.running = false;
    cron.abort?.abort();
    this.log.debug(`Cron task '${cron.name}' stopped`);
  }

  /**
   * Registers a cron job.
   *
   * `$job({ cron })` registers through here automatically. Call this
   * directly when you need a bare periodic tick with no database — you get
   * no run history, no retry and no admin view in exchange.
   */
  public createCronJob(
    name: string,
    expression: string,
    handler: (context: { now: DateTime }) => Promise<void>,
    start?: boolean,
  ): void {
    const cron: CronJob = {
      name,
      cron: this.parseCronJob(name, expression),
      expression,
      handler,
      loop: true,
      abort: new AbortController(),
    };

    this.cronJobs.push(cron);

    if (start && this.alepha.isStarted()) {
      this.boot(cron);
    }
  }

  /**
   * Validates that the name is unused and the expression parses.
   * Shared by the Node and Workerd `createCronJob` implementations.
   */
  protected parseCronJob(name: string, expression: string): Cron {
    if (this.cronJobs.some((job) => job.name === name)) {
      throw new AlephaError(`Cron job '${name}' is already registered`);
    }

    try {
      return parseCronExpression(expression);
    } catch (error) {
      throw new AlephaError(
        `Invalid cron expression '${expression}' for cron job '${name}'`,
        { cause: error },
      );
    }
  }

  protected run(task: CronJob, now = this.dt.now()): void {
    if (!task.running) {
      return;
    }

    const [next] = task.cron.getNextDates(1, now.toDate());
    if (!next) {
      return;
    }

    const duration = next.getTime() - now.toDate().getTime();
    const abort = new AbortController();
    task.abort = abort;

    this.dt
      .wait(duration, {
        now: now.valueOf(),
        signal: abort.signal,
      })
      .then(() => {
        if (!task.running) {
          this.log.trace("Cron task stopped before execution");
          return;
        }

        this.log.trace("Running cron task");

        if (task.executing) {
          this.log.warn(
            `Cron task '${task.name}' is still running, skipping this invocation`,
          );
          if (task.loop) {
            this.run(task, this.dt.of(next));
          }
          return;
        }

        task.executing = true;
        task
          .handler({ now: this.dt.of(next) })
          .catch((err) => {
            if (task.onError) {
              task.onError(err);
            } else {
              this.log.error("Error in cron task:", err);
            }
          })
          .finally(() => {
            task.executing = false;
          });

        if (task.loop) {
          this.run(task, this.dt.of(next));
        }
      })
      .catch((err) => {
        this.log.warn("Issue during cron waiting timer", err as Error);
      });
  }

  /**
   * Trigger a specific cron job by name.
   */
  public async trigger(name: string): Promise<void> {
    const job = this.cronJobs.find((j) => j.name === name);
    if (!job) {
      this.log.warn(`Cron job '${name}' not found`);
      return;
    }
    await this.runJobs([job], this.dt.now());
  }

  /**
   * Trigger all registered cron jobs.
   */
  public async triggerAll(): Promise<void> {
    await this.runJobs(this.cronJobs, this.dt.now());
  }

  /**
   * Run multiple cron jobs in parallel.
   *
   * Shares the overlap guard with the timer loop: a job whose previous
   * invocation is still in flight — scheduled or triggered — is skipped, so
   * a manual `trigger()` (or a burst of serverless cron events) can never
   * run the same job concurrently with itself.
   */
  protected async runJobs(jobs: CronJob[], now: DateTime): Promise<void> {
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        if (job.executing) {
          this.log.warn(
            `Cron job '${job.name}' is still running, skipping this invocation`,
          );
          return;
        }

        job.executing = true;
        this.log.debug(`Running cron job '${job.name}'`);
        try {
          await job.handler({ now });
          this.log.debug(`Cron job '${job.name}' completed`);
        } catch (error) {
          this.log.error(`Cron job '${job.name}' failed`, error);
          throw error;
        } finally {
          job.executing = false;
        }
      }),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      this.log.error(`${failures.length}/${jobs.length} cron jobs failed`);
    }
  }
}

export interface CronJob {
  name: string;
  expression: string;
  handler: (context: { now: DateTime }) => Promise<void>;
  cron: Cron;
  loop: boolean;
  running?: boolean;
  executing?: boolean;
  onError?: (error: Error) => void;
  abort?: AbortController;
}
