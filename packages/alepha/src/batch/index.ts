import { $module } from "alepha";
import { $batch } from "./primitives/$batch.ts";
import { BatchProvider } from "./providers/BatchProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$batch.ts";
export * from "./providers/BatchProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.8.0 | node, bun|
 *
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
