import {
  $atom,
  $hook,
  $inject,
  $use,
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Queue worker configuration atom.
 */
export const queueWorkerOptions = $atom({
  name: "alepha.queue.worker.options",
  schema: t.object({
    interval: t.integer({
      default: 1000,
      description:
        "Interval in milliseconds to wait before checking for new messages.",
    }),
    maxInterval: t.integer({
      default: 32000,
      description:
        "Maximum interval in milliseconds to wait before checking for new messages.",
    }),
    concurrency: t.integer({
      default: 1,
      description:
        "Number of workers to run concurrently. Useful only if you are doing a lot of I/O.",
    }),
  }),
  default: {
    interval: 1000,
    maxInterval: 32000,
    concurrency: 1,
  },
});

export type QueueWorkerOptions = Static<typeof queueWorkerOptions.schema>;

declare module "alepha" {
  interface State {
    [queueWorkerOptions.key]: QueueWorkerOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class WorkerProvider {
  protected readonly log = $logger();
  protected readonly options = $use(queueWorkerOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly queueProvider = $inject(QueueProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  protected workerPromises: Array<Promise<void>> = [];
  protected workersRunning = 0;
  protected abortController: AbortController | undefined;
  protected workerIntervals: Record<number, number> = {};
  protected consumers: Array<Consumer> = [];
  protected nextConsumerIndex = 0;

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
        this.consumers.push({
          queue: consumer.options.queue,
          handler: (msg) => consumer.handler.run(msg),
        });
      }

      if (this.consumers.length > 0) {
        this.startWorkers();
        this.log.debug(
          `Watching for ${this.consumers.length} queue${this.consumers.length > 1 ? "s" : ""} with ${this.options.concurrency} worker${
            this.options.concurrency > 1 ? "s" : ""
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
    this.abortController ??= new AbortController();
    const workerToStart = this.options.concurrency - this.workersRunning;

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
          this.workersRunning = Math.max(0, this.workersRunning - 1);
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
    const milliseconds = intervals[n] || this.options.interval;

    this.log.trace(`Worker n-${n} is waiting for ${milliseconds}ms.`);

    if (this.abortController?.signal.aborted) {
      this.log.warn(`Worker n-${n} aborted.`);
      return;
    }

    await this.dateTimeProvider.wait(milliseconds, {
      signal: this.abortController?.signal,
    });

    if (intervals[n]) {
      if (intervals[n] < this.options.maxInterval) {
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
    const len = this.consumers.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.nextConsumerIndex + i) % len;
      const consumer = this.consumers[idx];
      const provider = consumer.queue.provider;
      const message = await provider.pop(consumer.queue.name);
      if (message) {
        this.nextConsumerIndex = (idx + 1) % len;
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
    this.abortController?.abort();

    this.log.trace("Waiting for workers to finish...");
    await Promise.all(this.workerPromises);
  }

  /**
   * Force the workers to get back to work.
   */
  public wakeUp(): void {
    this.log.debug("Waking up workers...");
    this.abortController?.abort();
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
