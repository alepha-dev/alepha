import { $module } from "alepha";
import { $retry } from "./primitives/$retry.ts";
import { RetryProvider } from "./providers/RetryProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/RetryCancelError.ts";
export * from "./errors/RetryTimeoutError.ts";
export * from "./primitives/$retry.ts";
export * from "./providers/RetryProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Automatic retry with backoff.
 *
 * **Features:**
 * - Retry configuration
 * - Exponential backoff
 * - Max retry limits
 * - Custom retry predicates
 *
 * @module alepha.retry
 */
export const AlephaRetry = $module({
  name: "alepha.retry",
  primitives: [$retry],
  services: [RetryProvider],
});
