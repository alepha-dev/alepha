import { $module, type Alepha } from "alepha";
import { $consumer } from "./primitives/$consumer.ts";
import { $queue } from "./primitives/$queue.ts";
import { CloudflareQueueProvider } from "./providers/CloudflareQueueProvider.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerdWorkerProvider } from "./providers/WorkerdWorkerProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$consumer.ts";
export * from "./primitives/$queue.ts";
export * from "./providers/CloudflareQueueProvider.ts";
export * from "./providers/MemoryQueueProvider.ts";
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
 * Asynchronous message processing with automatic worker management.
 *
 * Delivery is **at-most-once** at this layer: a message is popped before the
 * handler runs, so a handler error or a crash loses it. Alepha adds no retry
 * and no dead-letter queue on top. **For work that must not be lost, use
 * `$job` (alepha/api/jobs)** — a durable, DB-backed outbox over this
 * transport. (Cloudflare Queues has its own broker-level retry/DLQ, configured
 * on the binding, not by this module.)
 *
 * **Features:**
 * - Background job queues with type-safe payloads
 * - Queue consumer handlers
 * - Automatic worker threads for non-blocking processing
 * - Configurable concurrency and worker pools
 * - Providers: Memory (dev), Redis (production), Cloudflare Queue (workerd)
 *
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  primitives: [$queue, $consumer],
  services: [QueueProvider, WorkerProvider],
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
