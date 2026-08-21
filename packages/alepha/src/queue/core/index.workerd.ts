import { $module, type Alepha } from "alepha";

import { CloudflareQueueProvider } from "./providers/CloudflareQueueProvider.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueCodec } from "./providers/QueueCodec.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerdWorkerProvider } from "./providers/WorkerdWorkerProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CloudflareQueueProvider.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueCodec.ts";
export * from "./providers/QueueProvider.ts";
export * from "./providers/WorkerdWorkerProvider.ts";
export * from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Cloudflare Workers queue message event.
     *
     * Emitted when a queue consumer receives a message in Cloudflare Workers.
     */
    "cloudflare:queue": {
      queue: string;
      message: string;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Message transport used under `$job`. **Not an application-facing API.**
 *
 * There is no queue primitive. Declare background work with
 * `$job` (`alepha/api/jobs`) and add `AlephaApiJobsQueue` when you want
 * dispatch to travel through Cloudflare Queues instead of running in-process.
 *
 * On Cloudflare, consumption is push-based: the Worker's `queue` handler
 * emits `cloudflare:queue` and calls `msg.retry()` when handling throws, so
 * undeliverable messages reach the `dead_letter_queue` the build writes into
 * `wrangler.jsonc`. A `$job` handler that throws is caught and recorded by
 * `JobProvider` instead, and retried by the outbox sweep.
 *
 * **Features:**
 * - Consumers registered imperatively via `WorkerProvider.register`
 * - Push-based delivery via the `cloudflare:queue` event (no polling)
 * - Batch send via `sendBatch` (`QueueProvider.pushMany`, chunked at 100)
 * - Providers: Memory (test), Cloudflare Queue (workerd)
 *
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  services: [QueueProvider, WorkerProvider, QueueCodec],
  variants: [
    MemoryQueueProvider,
    CloudflareQueueProvider,
    WorkerdWorkerProvider,
  ],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: QueueProvider,
        use: alepha.isTest() ? MemoryQueueProvider : CloudflareQueueProvider,
      })
      .with({
        provide: WorkerProvider,
        use: alepha.isTest() ? WorkerProvider : WorkerdWorkerProvider,
      }),
});
