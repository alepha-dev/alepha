import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $consumer } from "../primitives/$consumer.ts";
import { $queue } from "../primitives/$queue.ts";
import { WorkerProvider } from "./WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare Workers queue consumer provider.
 *
 * Replaces the polling-based `WorkerProvider` in Cloudflare Workers.
 * Instead of running a polling loop, this provider hooks into `cloudflare:queue`
 * events emitted by the CF Workers `queue` handler.
 *
 * @see https://developers.cloudflare.com/queues/
 */
export class WorkerdWorkerProvider extends WorkerProvider {
  protected override readonly alepha = $inject(Alepha);
  protected override readonly log = $logger();

  /**
   * Override start hook — collect consumers but do NOT start polling workers.
   */
  protected override readonly start = $hook({
    on: "start",
    priority: "last",
    handler: () => {
      for (const queue of this.alepha.primitives($queue)) {
        const handler = queue.options.handler;
        if (handler) {
          this.consumers.push({ handler, queue });
        }
      }

      for (const consumer of this.alepha.primitives($consumer)) {
        // Mirror the Node WorkerProvider: run through the pipeline-wrapped
        // handler so `use` middleware ($retry, $lock, ...) applies on
        // Cloudflare too — pushing the raw options handler silently drops it.
        this.consumers.push({
          queue: consumer.options.queue,
          handler: (msg) => consumer.handler.run(msg),
        });
      }

      if (this.consumers.length > 0) {
        this.log.debug(
          `Registered ${this.consumers.length} queue consumer${this.consumers.length > 1 ? "s" : ""} for Cloudflare Queue.`,
        );
      }
    },
  });

  /**
   * Override stop hook — no workers to stop on Cloudflare.
   */
  protected override readonly stop = $hook({
    on: "stop",
    handler: () => {},
  });

  /**
   * Handle incoming messages from Cloudflare Queue.
   */
  protected readonly onQueueMessage = $hook({
    on: "cloudflare:queue",
    handler: async (event: { queue: string; message: string }) => {
      const consumer = this.consumers.find((c) => c.queue.name === event.queue);

      if (!consumer) {
        this.log.warn(
          `No consumer found for queue '${event.queue}', skipping message.`,
        );
        return;
      }

      await this.processMessage({ message: event.message, consumer });
    },
  });

  /**
   * No-op on Cloudflare — no workers to wake.
   */
  public override wakeUp(): void {}
}
