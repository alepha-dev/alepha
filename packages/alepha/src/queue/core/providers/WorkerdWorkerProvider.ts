import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

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
   * Override the start hook — consumers register themselves via
   * `WorkerProvider.register`; here we must only make sure the polling
   * workers never start. Cloudflare delivers messages push-based through
   * the `cloudflare:queue` event instead.
   */
  protected override readonly start = $hook({
    on: "start",
    priority: "last",
    handler: () => {
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
   *
   * Errors are **not** caught here. The generated worker's `queue` handler
   * calls `msg.retry()` when this emit rejects, which is what feeds the
   * `dead_letter_queue` the build writes into `wrangler.jsonc`. Swallowing
   * the error made every message ack unconditionally and turned both
   * `max_retries` and the DLQ into dead configuration.
   *
   * Note this only surfaces *infrastructure* failures (undecodable payload,
   * backend unreachable). A `$job` handler that throws is caught and
   * recorded by `JobProvider` itself, so it acks and retries through the
   * outbox sweep rather than through the broker.
   */
  protected readonly onQueueMessage = $hook({
    on: "cloudflare:queue",
    handler: async (event: { queue: string; message: string }) => {
      const consumer = this.consumers.find((c) => c.name === event.queue);

      if (!consumer) {
        // Deliberately ack: an unroutable queue name is usually a consumer
        // that was removed in a deploy. Retrying would spin the message
        // until it hits max_retries with no chance of ever succeeding.
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
