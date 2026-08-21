import { $module } from "alepha";

import { $batch } from "./primitives/$batch.ts";
import { BatchProvider } from "./providers/BatchProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$batch.ts";
export * from "./providers/BatchProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Batch accumulation and processing.
 *
 * **Features:**
 * - Batch accumulator with handler
 * - Configurable batch size
 * - Time-based triggers
 * - Status tracking
 *
 * @module alepha.batch
 */
export const AlephaBatch = $module({
  name: "alepha.batch",
  primitives: [$batch],
  services: [BatchProvider],
});
