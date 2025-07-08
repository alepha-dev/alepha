import { __bind, type Alepha, type Module } from "@alepha/core";
import { $batch } from "./descriptors/$batch.ts";
import { BatchDescriptorProvider } from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$batch.ts";
export * from "./providers/BatchDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Batch Module
 *
 * This module provides a powerful batch processing utility that can group
 * multiple operations into a single one based on size, time, or partitions.
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
