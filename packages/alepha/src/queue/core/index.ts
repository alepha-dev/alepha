import { $module, type Alepha } from "alepha";
import { $consumer } from "./primitives/$consumer.ts";
import { $queue } from "./primitives/$queue.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$consumer.ts";
export * from "./primitives/$queue.ts";
export * from "./providers/CloudflareQueueProvider.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueProvider.ts";
export * from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Asynchronous message processing with automatic worker management.
 *
 * Delivery is **at-most-once**: a message is popped from the backend before
 * the handler runs, so a handler error or a process crash loses it. There is
 * no retry, no dead-letter queue and no delivery guarantee at this layer.
 * **For work that must not be lost, use `$job` (alepha/api/jobs)** — it layers
 * a durable, DB-backed outbox over this transport.
 *
 * **Features:**
 * - Background job queues with type-safe payloads
 * - Queue consumer handlers
 * - Automatic worker threads for non-blocking processing
 * - Configurable concurrency and worker pools
 * - Providers: Memory (dev), Redis (production), Cloudflare Queues
 *
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  primitives: [$queue, $consumer],
  services: [QueueProvider, WorkerProvider],
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
