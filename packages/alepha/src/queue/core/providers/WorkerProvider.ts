import {
  $env,
  $hook,
  $inject,
  Alepha,
  type Static,
  type TSchema,
  t,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { QueueAcquiredJob } from "../interfaces/QueueJob.ts";
import { $consumer } from "../primitives/$consumer.ts";
import {
  $queue,
  type QueueMessage,
  type QueuePrimitive,
} from "../primitives/$queue.ts";
import { QueueProvider } from "./QueueProvider.ts";

const envSchema = t.object({
  /**
   * The timeout in seconds for blocking job acquisition.
   * Workers will check for shutdown after each timeout period.
   */
  QUEUE_WORKER_BLOCKING_TIMEOUT: t.integer({
    default: 5,
  }),
  /**
   * The number of workers to run concurrently. Defaults to 1.
   * Useful only if you are doing a lot of I/O.
   */
  QUEUE_WORKER_CONCURRENCY: t.integer({
    default: 1,
  }),
  /**
   * Interval in milliseconds for renewing job locks during processing.
   * Should be less than the job's lock duration.
   */
  QUEUE_WORKER_LOCK_RENEWAL_INTERVAL: t.integer({
    default: 10000, // 10 seconds
  }),
  /**
   * Interval in milliseconds for the scheduler to check delayed jobs and stalled jobs.
   */
  QUEUE_SCHEDULER_INTERVAL: t.integer({
    default: 5000, // 5 seconds
  }),
  /**
   * Threshold in milliseconds after lock expiration to consider a job stalled.
   */
  QUEUE_STALLED_THRESHOLD: t.integer({
    default: 5000, // 5 seconds grace period after lock expires
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class WorkerProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly queueProvider = $inject(QueueProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected workerPromises: Array<Promise<void>> = [];
  protected workersRunning = 0;
  protected shouldStop = false;
  protected consumers: Array<Consumer> = [];
  protected consumersByProvider: Map<QueueProvider, Consumer[]> = new Map();
  protected schedulerPromise: Promise<void> | undefined;
  protected schedulerRunning = false;
  protected abortController: AbortController | undefined;
  protected workerId: string = `worker_${process.pid}_${Date.now()}`;

  public get isRunning(): boolean {
    return this.workersRunning > 0;
  }

  protected readonly start = $hook({
    on: "start",
    priority: "last",
    handler: () => {
      for (const queue of this.alepha.primitives($queue)) {
        const handler = queue.options.handler;
        if (handler) {
          this.consumers.push({
            handler,
            queue,
          });
        }
      }

      for (const consumer of this.alepha.primitives($consumer)) {
        this.consumers.push(consumer.options);
      }

      // Group consumers by their provider for efficient blocking
      for (const consumer of this.consumers) {
        const provider = consumer.queue.provider;
        const list = this.consumersByProvider.get(provider) ?? [];
        list.push(consumer);
        this.consumersByProvider.set(provider, list);
      }

      if (this.consumers.length > 0) {
        this.startWorkers();
        this.startScheduler();
        this.log.debug(
          `Watching for ${this.consumers.length} queue${this.consumers.length > 1 ? "s" : ""} with ${this.env.QUEUE_WORKER_CONCURRENCY} worker${
            this.env.QUEUE_WORKER_CONCURRENCY > 1 ? "s" : ""
          }.`,
        );
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  // Engine part - this is the part that will run the workers and process the jobs

  /**
   * Start the workers.
   * Each worker acquires jobs and processes them with proper lifecycle management.
   */
  protected startWorkers(): void {
    const workerToStart =
      this.env.QUEUE_WORKER_CONCURRENCY - this.workersRunning;

    for (let i = 0; i < workerToStart; i++) {
      this.workersRunning += 1;
      const workerIndex = i;
      const localWorkerId = `${this.workerId}_${workerIndex}`;
      this.log.debug(`Starting worker n-${workerIndex}`);

      const workerLoop = async () => {
        while (!this.shouldStop) {
          this.log.trace(`Worker n-${workerIndex} is waiting for jobs`);
          const acquired = await this.acquireNextJob(localWorkerId);
          if (acquired) {
            await this.processJob(acquired, localWorkerId);
          }
          // If no job (timeout), loop continues and checks shouldStop
        }
        this.log.info(`Worker n-${workerIndex} has stopped`);
      };

      this.workerPromises.push(
        workerLoop().catch((e) => {
          this.log.error(`Worker n-${workerIndex} has crashed`, e);
          this.workersRunning -= 1;
        }),
      );
    }
  }

  /**
   * Start the scheduler for delayed job promotion and stalled job recovery.
   */
  protected startScheduler(): void {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    this.abortController = new AbortController();
    this.log.debug("Starting scheduler");

    const schedulerLoop = async () => {
      while (!this.shouldStop) {
        try {
          await this.runSchedulerCycle();
        } catch (e) {
          this.log.error("Scheduler cycle failed", e);
        }

        // Wait for next interval (interruptible via AbortController)
        await this.dateTime.wait(this.env.QUEUE_SCHEDULER_INTERVAL, {
          signal: this.abortController?.signal,
        });
      }
      this.log.debug("Scheduler stopped");
    };

    this.schedulerPromise = schedulerLoop();
  }

  /**
   * Run one cycle of the scheduler.
   * Promotes delayed jobs and recovers stalled jobs.
   */
  protected async runSchedulerCycle(): Promise<void> {
    for (const [provider, consumers] of this.consumersByProvider) {
      const queues = new Set(consumers.map((c) => c.queue.name));

      for (const queue of queues) {
        // Promote delayed jobs
        const promoted = await provider.promoteDelayedJobs(queue);
        if (promoted > 0) {
          this.log.debug(`Promoted ${promoted} delayed jobs in queue ${queue}`);
        }

        // Recover stalled jobs
        const recovered = await provider.recoverStalledJobs(
          queue,
          this.env.QUEUE_STALLED_THRESHOLD,
        );
        if (recovered.length > 0) {
          this.log.warn(
            `Recovered ${recovered.length} stalled jobs in queue ${queue}`,
          );
        }
      }
    }
  }

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      if (this.consumers.length > 0) {
        await this.stopWorkers();
      }
    },
  });

  /**
   * Acquire the next available job from any provider.
   */
  protected async acquireNextJob(
    localWorkerId: string,
  ): Promise<AcquiredJobWithConsumer | undefined> {
    for (const [provider, consumers] of this.consumersByProvider) {
      const queueNames = consumers.map((c) => c.queue.name);
      const acquired = await provider.acquireJob(
        queueNames,
        localWorkerId,
        this.env.QUEUE_WORKER_BLOCKING_TIMEOUT,
      );

      if (acquired) {
        const consumer = consumers.find((c) => c.queue.name === acquired.queue);
        if (consumer) {
          return { acquired, consumer, provider };
        }
      }
    }

    return undefined;
  }

  /**
   * Process a job with proper lifecycle management.
   * - Starts a lock renewal interval
   * - Calls the handler
   * - Marks job as completed or failed
   */
  protected async processJob(
    { acquired, consumer, provider }: AcquiredJobWithConsumer,
    localWorkerId: string,
  ): Promise<void> {
    const { queue, job } = acquired;

    // Start lock renewal heartbeat
    const lockRenewalInterval = this.dateTime.createInterval(
      async () => {
        try {
          const renewed = await provider.renewJobLock(
            queue,
            job.id,
            localWorkerId,
          );
          if (!renewed) {
            this.log.warn(
              `Failed to renew lock for job ${job.id}, lock may have been stolen`,
            );
          }
        } catch (e) {
          this.log.error(`Error renewing lock for job ${job.id}`, e);
        }
      },
      this.env.QUEUE_WORKER_LOCK_RENEWAL_INTERVAL,
      true, // start immediately
    );

    try {
      // Decode payload and run handler
      const payload = this.alepha.codec.decode(
        consumer.queue.options.schema,
        job.payload,
      );

      await this.alepha.context.run(() => consumer.handler({ payload }));

      // Mark as completed
      await provider.completeJob(queue, job.id);
      this.log.debug(`Job ${job.id} completed successfully`, { queue });
    } catch (e) {
      // Mark as failed (provider handles retry logic)
      const error = e instanceof Error ? e.message : String(e);
      const stackTrace = e instanceof Error ? e.stack : undefined;
      await provider.failJob(queue, job.id, error, stackTrace);
      this.log.error(`Job ${job.id} failed`, e);
    } finally {
      this.dateTime.clearInterval(lockRenewalInterval);
    }
  }

  /**
   * Stop the workers and scheduler.
   */
  protected async stopWorkers(): Promise<void> {
    this.shouldStop = true;
    this.workersRunning = 0;
    this.schedulerRunning = false;

    // Abort the scheduler's wait immediately
    this.abortController?.abort();

    // Cancel all pending acquireJob waiters to unblock workers immediately
    for (const provider of this.consumersByProvider.keys()) {
      provider.cancelWaiters();
    }

    this.log.trace("Stopping workers...");
    this.log.trace("Waiting for workers to finish...");

    const promises: Promise<void>[] = [...this.workerPromises];
    if (this.schedulerPromise) {
      promises.push(this.schedulerPromise);
    }

    await Promise.all(promises);
  }
}

export interface Consumer<T extends TSchema = TSchema> {
  queue: QueuePrimitive<T>;
  handler: (message: QueueMessage<T>) => Promise<void>;
}

export interface AcquiredJobWithConsumer {
  acquired: QueueAcquiredJob;
  consumer: Consumer;
  provider: QueueProvider;
}
