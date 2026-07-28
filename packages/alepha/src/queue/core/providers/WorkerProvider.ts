import {
  $atom,
  $hook,
  $inject,
  $state,
  Alepha,
  type Static,
  type TSchema,
  z,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { QueueCodec } from "./QueueCodec.ts";
import { QueueProvider } from "./QueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Queue worker configuration atom.
 */
export const queueWorkerOptions = $atom({
  name: "alepha.queue.worker.options",
  schema: z.object({
    interval: z
      .integer()
      .describe(
        "Interval in milliseconds to wait before checking for new messages.",
      )
      .default(1000),
    maxInterval: z
      .integer()
      .describe(
        "Maximum interval in milliseconds to wait before checking for new messages.",
      )
      .default(32000),
    concurrency: z
      .integer()
      .describe(
        "Number of workers to run concurrently. Useful only if you are doing a lot of I/O.",
      )
      .default(1),
  }),
  default: {
    interval: 1000,
    maxInterval: 32000,
    concurrency: 1,
  },
  serverOnly: true,
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
  protected readonly options = $state(queueWorkerOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly queueProvider = $inject(QueueProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly codec = $inject(QueueCodec);

  protected workerPromises: Array<Promise<void>> = [];
  protected workersRunning = 0;
  protected abortController: AbortController | undefined;
  protected workerIntervals: Record<number, number> = {};
  protected consumers: Array<QueueConsumer> = [];
  protected nextConsumerIndex = 0;

  public get isRunning(): boolean {
    return this.workersRunning > 0;
  }

  /**
   * Register a consumer to be polled by the worker loop.
   *
   * Call this before the `start` hook fires — this provider's own start hook
   * runs at `priority: "last"`, so a registration made from any normal
   * start hook lands in time.
   */
  public register(consumer: QueueConsumer<any>): void {
    // Guard against a restart re-registering the same consumer: `consumers`
    // was only ever appended to and never cleared on stop, so a second
    // start()/stop() cycle in one process (tests, a serverless warm reuse)
    // ran every handler twice.
    if (!this.consumers.includes(consumer)) {
      this.consumers.push(consumer);
    }
  }

  protected readonly start = $hook({
    on: "start",
    priority: "last",
    handler: () => {
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

          // A backend blip must not end the loop. `getNextMessage` talks to
          // the queue provider (Redis, Cloudflare), so a transient error here
          // is expected — and letting it escape killed the worker for good:
          // at the default concurrency of 1 the queue silently stopped being
          // polled, with nothing to restart it but a local `push()`.
          let next: NextMessage | undefined;
          try {
            next = await this.getNextMessage();
          } catch (error) {
            this.log.error(
              `Worker n-${i} failed to fetch the next message; backing off`,
              error,
            );
            await this.waitForNextMessage(i);
            continue;
          }

          if (next) {
            this.workerIntervals[i] = 0;
            // Swallow here, NOT in `processMessage`. On this transport the
            // message is already popped and gone, so there is nothing to
            // redeliver — logging is all we can do, and the loop must
            // survive. Push-based transports (Cloudflare) need the error to
            // escape instead so the broker can retry; see
            // `WorkerdWorkerProvider.onQueueMessage`.
            try {
              await this.processMessage(next);
            } catch (e) {
              this.log.error("Failed to process message", e);
            }
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
      const message = await consumer.provider.pop(consumer.name);
      if (message) {
        this.nextConsumerIndex = (idx + 1) % len;
        return { message, consumer };
      }
    }
  }

  /**
   * Process a message from a queue.
   *
   * **Throws on failure — deliberately.** Callers decide what a failure
   * means for their transport: the polling loop logs and moves on (the
   * message is already gone), while the Cloudflare consumer lets it escape
   * so the runtime calls `msg.retry()` and the message can reach the
   * configured dead-letter queue. Catching here made that DLQ unreachable.
   */
  protected async processMessage(response: {
    message: any;
    consumer: QueueConsumer;
  }) {
    const { message, consumer } = response;

    const payload = this.codec.decode(consumer.schema, message);
    await this.alepha.context.run(() => consumer.handler({ payload }));
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

/**
 * A queue the worker loop should drain.
 *
 * Registered imperatively via {@link WorkerProvider.register} rather than
 * discovered from a primitive — queues are an internal transport under
 * `$job`, not something applications declare.
 */
export interface QueueConsumer<T extends TSchema = TSchema> {
  /**
   * Logical queue name, used as the backend key.
   */
  name: string;

  /**
   * Payload schema. Messages are decoded against it before the handler runs.
   */
  schema: T;

  /**
   * Backend this queue lives on.
   */
  provider: QueueProvider;

  /**
   * Invoked once per message. A throw loses the message on polling backends;
   * see {@link WorkerProvider.processMessage}.
   */
  handler: (message: { payload: Static<T> }) => Promise<void>;
}

export interface NextMessage {
  consumer: QueueConsumer;
  message: string;
}
