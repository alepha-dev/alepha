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
import { $consumer } from "../primitives/$consumer.ts";
import {
  $queue,
  type QueueMessage,
  type QueuePrimitive,
} from "../primitives/$queue.ts";
import { QueueProvider } from "./QueueProvider.ts";

const envSchema = t.object({
  /**
   * The interval in milliseconds to wait before checking for new messages.
   */
  QUEUE_WORKER_INTERVAL: t.integer({
    default: 1000,
  }),
  /**
   * The maximum interval in milliseconds to wait before checking for new messages.
   */
  QUEUE_WORKER_MAX_INTERVAL: t.integer({
    default: 32000,
  }),
  /**
   * The number of workers to run concurrently. Defaults to 1.
   * Useful only if you are doing a lot of I/O.
   */
  QUEUE_WORKER_CONCURRENCY: t.integer({
    default: 1,
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
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  protected workerPromises: Array<Promise<void>> = [];
  protected workersRunning = 0;
  protected abortController = new AbortController();
  protected workerIntervals: Record<number, number> = {};
  protected consumers: Array<Consumer> = [];

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

      if (this.consumers.length > 0) {
        this.startWorkers();
        this.log.debug(
          `Watching for ${this.consumers.length} queue${this.consumers.length > 1 ? "s" : ""} with ${this.env.QUEUE_WORKER_CONCURRENCY} worker${
            this.env.QUEUE_WORKER_CONCURRENCY > 1 ? "s" : ""
          }.`,
        );
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  // Engine part - this is the part that will run the workers and process the messages

  /**
   * Start the workers.
   * This method will create an endless loop that will check for new messages!
   */
  protected startWorkers(): void {
    const workerToStart =
      this.env.QUEUE_WORKER_CONCURRENCY - this.workersRunning;

    for (let i = 0; i < workerToStart; i++) {
      this.workersRunning += 1;
      this.log.debug(`Starting worker n-${i}`);

      const workerLoop = async () => {
        while (this.workersRunning > 0) {
          this.log.trace(`Worker n-${i} is checking for new messages`);
          const next = await this.getNextMessage();
          if (next) {
            this.workerIntervals[i] = 0;
            await this.processMessage(next);
          } else {
            await this.waitForNextMessage(i);
          }
        }
        this.log.info(`Worker n-${i} has stopped`);
        // Only decrement if we're not already at 0 (shutdown case)
        if (this.workersRunning > 0) {
          this.workersRunning -= 1;
        }
      };

      this.workerPromises.push(
        workerLoop().catch((e) => {
          this.log.error(`Worker n-${i} has crashed`, e);
          // Always decrement on crash, regardless of shutdown state
          this.workersRunning -= 1;
        }),
      );
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
   * Wait for the next message, where `n` is the worker number.
   *
   * This method will wait for a certain amount of time, increasing the wait time again if no message is found.
   */
  protected async waitForNextMessage(n: number): Promise<void> {
    const intervals = this.workerIntervals;
    const milliseconds = intervals[n] || this.env.QUEUE_WORKER_INTERVAL;

    this.log.trace(`Worker n-${n} is waiting for ${milliseconds}ms.`);

    if (this.abortController.signal.aborted) {
      this.log.warn(`Worker n-${n} aborted.`);
      return;
    }

    await this.dateTimeProvider.wait(milliseconds, {
      signal: this.abortController.signal,
    });

    if (intervals[n]) {
      if (intervals[n] < this.env.QUEUE_WORKER_MAX_INTERVAL) {
        intervals[n] = intervals[n] * 2;
      }
    } else {
      intervals[n] = milliseconds;
    }
  }

  /**
   * Get the next message.
   */
  protected async getNextMessage(): Promise<undefined | NextMessage> {
    for (const consumer of this.consumers) {
      const provider = consumer.queue.provider;
      const message = await provider.pop(consumer.queue.name);
      if (message) {
        return { message, consumer };
      }
    }
  }

  /**
   * Process a message from a queue.
   */
  protected async processMessage(response: {
    message: any;
    consumer: Consumer;
  }) {
    const { message, consumer } = response;

    try {
      const json = JSON.parse(message);
      const payload = this.alepha.codec.decode(
        consumer.queue.options.schema,
        json.payload,
      );
      await this.alepha.context.run(() => consumer.handler({ payload }));
    } catch (e) {
      this.log.error("Failed to process message", e);
    }
  }

  /**
   * Stop the workers.
   *
   * This method will stop the workers and wait for them to finish processing.
   */
  protected async stopWorkers() {
    this.workersRunning = 0;

    this.log.trace("Stopping workers...");
    this.abortController.abort();

    this.log.trace("Waiting for workers to finish...");
    await Promise.all(this.workerPromises);
  }

  /**
   * Force the workers to get back to work.
   */
  public wakeUp(): void {
    this.log.debug("Waking up workers...");
    this.abortController.abort();
    this.abortController = new AbortController();

    // if no workers are running, start them, (should not happen, but just in case)
    this.startWorkers();
  }
}

export interface Consumer<T extends TSchema = TSchema> {
  queue: QueuePrimitive<T>;
  handler: (message: QueueMessage<T>) => Promise<void>;
}

export interface NextMessage {
  consumer: Consumer;
  message: string;
}
