import { $module, type Alepha } from "alepha";
import { $consumer } from "./descriptors/$consumer.ts";
import { $queue } from "./descriptors/$queue.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { WorkerProvider } from "./providers/WorkerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$consumer.ts";
export * from "./descriptors/$queue.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides asynchronous message queuing and processing capabilities through declarative queue descriptors.
 *
 * The queue module enables reliable background job processing and message passing using the `$queue` descriptor
 * on class properties. It supports schema validation, automatic retries, and multiple queue backends for
 * building scalable, decoupled applications with robust error handling.
 *
 * @see {@link $queue}
 * @see {@link $consumer}
 * @module alepha.queue
 */
export const AlephaQueue = $module({
  name: "alepha.queue",
  descriptors: [$queue, $consumer],
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
