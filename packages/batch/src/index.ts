import { __bind, type Alepha, type Module } from "@alepha/core";
import { $batch } from "./descriptors/$batch.ts";
import { BatchDescriptorProvider } from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$batch.ts";
export * from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together.
 * This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.
 *
 * ### Basic Example: A Simple Event Logger
 *
 * Let's create a batch processor that collects log messages and prints them to the console every 5 seconds or whenever 10 messages have been collected.
 *
 * ```ts
 * import { Alepha, $hook, run, t } from "alepha";
 * import { $batch } from "alepha/batch";
 *
 * class LoggingService {
 *   // define the batch processor
 *   logBatch = $batch({
 *     schema: t.string(),
 *     maxSize: 10,
 *     maxDuration: [5, "seconds"],
 *     handler: async (items) => {
 *       console.log(`[BATCH LOG] Processing ${items.length} events:`, items);
 *     },
 *   });
 *
 *   // example of how to use it
 *   onReady = $hook({
 *     on: "ready",
 *     handler: async () => {
 *       this.logBatch.push("Application started.");
 *       this.logBatch.push("User authenticated.");
 *       // ... more events pushed from elsewhere in the app
 *     },
 *   });
 * }
 * ```
 *
 * @see {@link $batch}
 * @module alepha.batch
 */
export class AlephaBatch implements Module {
	public readonly name = "alepha.batch";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha.with(BatchDescriptorProvider);
}

__bind($batch, AlephaBatch);
