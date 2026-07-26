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

/**
 * Message transport used under `$job`. **Not an application-facing API.**
 *
 * There is no queue primitive. Declare background work with
 * `$job` (`alepha/api/jobs`) and add `AlephaApiJobsQueue` when you want
 * dispatch to travel through a broker instead of running in-process.
 *
 * Delivery at this layer is **at-most-once**: a message is popped from the
 * backend before the handler runs, so a handler error or a process crash
 * loses it. There is no retry and no dead-letter queue here — `$job` supplies
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
