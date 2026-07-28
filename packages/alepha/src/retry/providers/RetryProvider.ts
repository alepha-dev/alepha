import { $inject } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { RetryCancelError } from "../errors/RetryCancelError.ts";
import { RetryTimeoutError } from "../errors/RetryTimeoutError.ts";

export interface RetryOptions<T extends (...args: any[]) => any> {
  /**
   * The function to retry.
   */
  handler: T;

  /**
   * The maximum number of attempts.
   *
   * @default 3
   */
  max?: number;

  /**
   * The backoff strategy for delays between retries.
   * Can be a fixed number (in ms) or a configuration object for exponential backoff.
   *
   * @default { initial: 200, factor: 2, jitter: true }
   */
  backoff?: number | RetryBackoffOptions;

  /**
   * An overall time limit for all retry attempts combined.
   *
   * e.g., `[5, 'seconds']`
   */
  maxDuration?: DurationLike;

  /**
   * A function that determines if a retry should be attempted based on the error.
   *
   * @default (error) => true (retries on any error)
   */
  when?: (error: Error) => boolean;

  /**
   * A custom callback for when a retry attempt fails.
   * This is called before the delay.
   */
  onError?: (error: Error, attempt: number, ...args: Parameters<T>) => void;

  /**
   * An AbortSignal to allow for external cancellation of the retry loop.
   */
  signal?: AbortSignal;

  /**
   * An additional AbortSignal to combine with the provided signal.
   * Used internally by $retry to handle app lifecycle.
   */
  additionalSignal?: AbortSignal;
}

export interface RetryBackoffOptions {
  /**
   * Initial delay in milliseconds.
   *
   * @default 200
   */
  initial?: number;

  /**
   * Multiplier for each subsequent delay.
   *
   * @default 2
   */
  factor?: number;

  /**
   * Maximum delay in milliseconds.
   */
  max?: number;

  /**
   * If true, adds a random jitter to the delay to prevent thundering herd.
   *
   * @default true
   */
  jitter?: boolean;
}

/**
 * Service for executing functions with automatic retry logic.
 * Supports exponential backoff, max duration, conditional retries, and cancellation.
 */
export class RetryProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Execute a function with automatic retry logic.
   */
  async retry<T extends (...args: any[]) => any>(
    options: RetryOptions<T>,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>> {
    const maxAttempts = options.max ?? 3;
    const when = options.when ?? (() => true);
    const { handler, onError } = options;

    let lastError: Error | undefined;
    const startTime = this.dateTime.nowMillis();

    const maxDurationMs = options.maxDuration
      ? this.dateTime.duration(options.maxDuration).asMilliseconds()
      : Infinity;

    // Combine user-provided signal with additional signal (e.g., app lifecycle)
    const signals = [options.signal, options.additionalSignal].filter(Boolean);
    const onAbort = () => {
      // Always set RetryCancelError when aborted, even if another error exists
      // This ensures cancellation takes precedence over retry errors
      lastError = new RetryCancelError();
    };

    // Add abort listeners to all signals
    for (const signal of signals) {
      signal?.addEventListener("abort", onAbort);
    }

    // FIX BUG #8: Create combined signal ONCE at the start instead of on each backoff
    // This prevents memory leak from creating multiple AbortSignal.any() instances
    const waitSignals = [options.signal, options.additionalSignal].filter(
      Boolean,
    ) as AbortSignal[];
    const combinedSignal =
      waitSignals.length > 0 ? AbortSignal.any(waitSignals) : undefined;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Check for cancellation
        if (signals.some((signal) => signal?.aborted)) {
          throw new RetryCancelError();
        }

        // Check for timeout before attempting
        if (this.dateTime.nowMillis() - startTime >= maxDurationMs) {
          throw new RetryTimeoutError(maxDurationMs);
        }

        try {
          // A success is a success, however late. `maxDuration` bounds how
          // long we keep RETRYING — it used to be re-checked here and throw,
          // discarding a result whose side effects were already committed, so
          // an outer layer (`$job`) re-ran work that had already completed.
          // Turning slowness into duplicate execution is worse than being
          // late.
          return await handler(...args);
        } catch (err) {
          lastError = err as Error;

          // Check for timeout after error
          if (this.dateTime.nowMillis() - startTime >= maxDurationMs) {
            throw new RetryTimeoutError(maxDurationMs);
          }

          // Log the error with warning level
          this.log.warn("Retry attempt failed", {
            attempt,
            maxAttempts,
            remainingAttempts: maxAttempts - attempt,
            error: lastError.message,
            errorName: lastError.name,
          });

          if (!(err instanceof Error) || !when(err)) {
            throw err; // don't retry if it's not an Error or `when` returns false
          }

          // FIX BUG #7: Call onError BEFORE checking if this is the final attempt
          // This ensures onError is called for ALL failed attempts, including the last one
          if (onError) {
            onError(err, attempt, ...args);
          }

          if (attempt >= maxAttempts) {
            break; // will throw lastError after the loop
          }

          // Calculate and wait for backoff delay
          const delay = this.calculateBackoff(attempt, options.backoff);
          if (delay > 0) {
            await this.dateTime.wait(delay, { signal: combinedSignal });
          }

          // Check for timeout after backoff wait before next attempt
          if (this.dateTime.nowMillis() - startTime >= maxDurationMs) {
            throw new RetryTimeoutError(maxDurationMs);
          }
        }
      }
    } finally {
      // Clean up listeners to prevent memory leaks
      for (const signal of signals) {
        signal?.removeEventListener("abort", onAbort);
      }
    }

    throw lastError;
  }

  /**
   * Calculate the backoff delay for a given attempt.
   */
  protected calculateBackoff(
    attempt: number,
    options?: number | RetryBackoffOptions,
  ): number {
    if (typeof options === "number") {
      return options;
    }

    const initial = options?.initial ?? 200;
    const factor = options?.factor ?? 2;
    const max = options?.max ?? 10000;
    const useJitter = options?.jitter !== false;

    const exponential = initial * factor ** (attempt - 1);
    let delay = Math.min(exponential, max);

    if (useJitter) {
      // Up to +50%, then clamp AGAIN. Jitter used to be applied after the
      // clamp, so a delay already at `max` came out 1.5x it — `backoff.max`
      // was not actually a maximum.
      delay = Math.min(delay * (1 + Math.random() * 0.5), max);
    }

    return Math.floor(delay);
  }
}
