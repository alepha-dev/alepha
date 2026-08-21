import { $module } from "alepha";

import { RetryProvider } from "./providers/RetryProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/RetryCancelError.ts";
export * from "./errors/RetryTimeoutError.ts";
export * from "./primitives/$retry.ts";
export * from "./providers/RetryProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
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
  services: [RetryProvider],
});
