import { $hook, $inject, Alepha } from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
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

  protected boot(name: string | CronJob) {
    const cron =
      typeof name === "string"
        ? this.cronJobs.find((c) => c.name === name)
        : name;

    if (!cron) {
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

    if (!cron) {
      return;
    }

    cron.running = false;
    cron.abort.abort();
    this.log.debug(`Cron task '${name}' stopped`);
  }

  /**
   * Registers a cron job.
   *
   * It's automatically done when using the `$scheduler` descriptor but can also be used manually.
   */
  public createCronJob(
    name: string,
    expression: string,
    handler: (context: { now: DateTime }) => Promise<void>,
    start?: boolean,
  ): void {
    const cron: CronJob = {
      name,
      cron: parseCronExpression(expression),
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

  protected run(task: CronJob, now = this.dt.now()): void {
    if (!task.running) {
      return;
    }

    const [next] = task.cron.getNextDates(1, now.toDate());
    if (!next) {
      return;
    }

    const duration = next.getTime() - now.toDate().getTime();

    task.abort = new AbortController();

    this.dt
      .wait(duration, {
        now: now.valueOf(),
        signal: task.abort.signal,
      })
      .then(() => {
        if (!task.running) {
          this.log.trace("Cron task stopped before execution");
          return;
        }

        this.log.trace("Running cron task");

        task.handler({ now: this.dt.of(next) }).catch((err) => {
          if (task.onError) {
            task.onError(err);
          } else {
            this.log.error("Error in cron task:", err);
          }
        });

        if (task.loop) {
          this.run(task, this.dt.of(next));
        }
      })
      .catch((err) => {
        this.log.warn("Issue during cron waiting timer", err as Error);
      });
  }
}

export interface CronJob {
  name: string;
  expression: string;
  handler: (context: { now: DateTime }) => Promise<void>;
  cron: Cron;
  loop: boolean;
  running?: boolean;
  onError?: (error: Error) => void;
  abort: AbortController;
}
