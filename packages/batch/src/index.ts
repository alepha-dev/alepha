import { __bind, type Alepha, type Module } from "@alepha/core";
import { $batch } from "./descriptors/$batch.ts";
import { BatchDescriptorProvider } from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$batch.ts";
export * from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * ## Alepha Batch
 *
 * A powerful batch processing utility for the Alepha framework.
 * This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together.
 * This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.
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
