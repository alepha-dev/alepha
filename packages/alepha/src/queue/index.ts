import { $module, type Alepha } from "alepha";
import { $consumer } from "./primitives/$consumer.ts";
import { $queue } from "./primitives/$queue.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/QueueJob.ts";
export * from "./primitives/$consumer.ts";
export * from "./primitives/$queue.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueProvider.ts";
export * from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides asynchronous message queuing and processing capabilities through declarative queue primitives.
 *
 * The queue module enables reliable background job processing and message passing using the `$queue` primitive
 * on class properties. It supports schema validation, automatic retries, and multiple queue backends for
 * building scalable, decoupled applications with robust error handling.
 *
 * @see {@link $queue}
 * @see {@link $consumer}
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  primitives: [$queue, $consumer],
  services: [QueueProvider, MemoryQueueProvider, WorkerProvider],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: QueueProvider,
        use: MemoryQueueProvider,
      })
      .with(WorkerProvider),
});
