import { $module, type Alepha } from "alepha";

import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueCodec } from "./providers/QueueCodec.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CloudflareQueueProvider.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueCodec.ts";
export * from "./providers/QueueProvider.ts";
export * from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Cloudflare Workers queue message event.
     *
     * Emitted for every message a queue consumer receives, with the body
     * passed through verbatim. Only the workerd build ever emits it, but the
     * NAME is declared here as well as in `index.workerd.ts`: a listener can
     * live in any module (bounce ingestion does), and those modules are
     * typechecked without the workerd entry. Declared in one place only, the
     * hook name does not exist as far as their compiler is concerned.
     *
     * ⚠️ **The body is not always alepha's envelope.** `{ queue, message }`
     * is what `$job` puts on its own queue, but a Worker can consume queues
     * it did not fill: Cloudflare's Email Sending event subscriptions
     * deliver `{ type: "cf.email.sending.…", source, payload, metadata }` to
     * the same handler. Both shapes arrive here, so every field is optional
     * and every listener must recognise its own body and return quietly on
     * anything else. A listener that warns about bodies meant for another
     * one is how a log budget disappears.
     */
    "cloudflare:queue": {
      /**
       * Present on alepha's own envelope, absent on a provider event.
       */
      queue?: string;
      message?: string;
      /**
       * Present on a Cloudflare event subscription message, e.g.
       * `cf.email.sending.message.bounced`.
       */
      type?: string;
      /**
       * Anything else the producer put on the wire.
       */
      [key: string]: unknown;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Message transport used under `$job`. **Not an application-facing API.**
 *
 * There is no queue primitive. Declare background work with
 * `$job` (`alepha/api/jobs`) and add `AlephaApiJobsQueue` when you want
 * dispatch to travel through a broker instead of running in-process.
 *
 * Delivery at this layer is **at-most-once**: a message is popped from the
 * backend before the handler runs, so a handler error or a process crash
 * loses it. There is no retry and no dead-letter queue here - `$job` supplies
 * those with a DB-backed outbox and a reconciliation sweep. (Cloudflare
 * Queues adds broker-level retry/DLQ, configured on the binding.)
 *
 * **Features:**
 * - Consumers registered imperatively via `WorkerProvider.register`
 * - Polling worker loop with configurable concurrency and backoff
 * - Batch send where the backend supports it (`QueueProvider.pushMany`)
 * - Providers: Memory (dev), Redis (production), Cloudflare Queues
 *
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  services: [QueueProvider, WorkerProvider, QueueCodec],
  variants: [MemoryQueueProvider],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: QueueProvider,
        use: MemoryQueueProvider,
      })
      .with(WorkerProvider),
});
