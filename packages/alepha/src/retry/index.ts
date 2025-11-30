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
 * Retry mechanism provider for Alepha applications.
 *
 * @see {@link RetryProvider}
 * @module alepha.retry
 */
export const AlephaRetry = $module({
  name: "alepha.retry",
  primitives: [$retry],
  services: [RetryProvider],
});
