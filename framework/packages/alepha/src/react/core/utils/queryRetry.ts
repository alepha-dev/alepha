import type { DateTimeProvider } from "alepha/datetime";

import { isAbortError, isNetworkError } from "./isNetworkError.ts";

/**
 * The statuses `useQuery` tries again by default: the request may succeed
 * when sent once more. A 500 is not one: since it is the wire shape of a
 * defect, it fails the same way twice. A 429 is not one either: the delay it
 * asks for does not reach the error.
 */
const RETRIED_STATUSES = new Set([408, 502, 503, 504]);

/**
 * Whether `useQuery` retries `error` by default: no HTTP response (a network
 * failure), or a 408, 502, 503 or 504, a `TimeoutError` included. Never an
 * abort, another 4xx, a 429, a 500, or an error with no status that is not a
 * network failure.
 *
 * Exported so a `retry` predicate can build on the default rather than
 * restate it: `retry: (error, attempt) => attempt <= 5 && isRetryableError(error)`.
 */
export const isRetryableError = (error: unknown): boolean => {
  if (isAbortError(error)) {
    return false;
  }
  const status = statusOf(error);
  if (status !== undefined) {
    return RETRIED_STATUSES.has(status);
  }
  return isNetworkError(error);
};

/**
 * What a query's `retry` option accepts: how many retries after the first
 * attempt, `false` for none, or a predicate deciding each one. `attempt` is
 * the number of the retry about to be made, from 1.
 */
export type QueryRetry =
  | number
  | false
  | ((error: Error, attempt: number) => boolean);

/**
 * The delay before retry number `attempt` (from 1): 1 s, doubling, capped at
 * 30 s, then scaled by a random factor between 0.75 and 1.25 so that clients
 * failing together do not retry together.
 */
export const retryDelay = (attempt: number): number => {
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
};

/**
 * Run `fn`, trying again on failure as `retry` says, and waiting between
 * attempts through `dateTime` so that `travel()` drives it in specs.
 *
 * `signal` stops it: an abort during an attempt or a wait rejects at once
 * with an `AbortError`, and no timer outlives it.
 */
export const withRetry = async <T>(
  fn: () => Promise<T> | T,
  options: {
    retry: QueryRetry;
    signal?: AbortSignal;
    dateTime: DateTimeProvider;
  },
): Promise<T> => {
  const { retry, signal, dateTime } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (signal?.aborted || !shouldRetry(retry, error, attempt)) {
        throw error;
      }
    }
    await dateTime.wait(retryDelay(attempt), { signal });
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
  }
};

const shouldRetry = (
  retry: QueryRetry,
  error: unknown,
  attempt: number,
): boolean => {
  if (isAbortError(error)) {
    return false;
  }
  if (typeof retry === "function") {
    return retry(
      error instanceof Error ? error : new Error(String(error)),
      attempt,
    );
  }
  if (retry === false || attempt > retry) {
    return false;
  }
  return isRetryableError(error);
};

const statusOf = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const it = error as { status?: unknown; data?: { status?: unknown } };
  const status = it.status ?? it.data?.status;
  return typeof status === "number" ? status : undefined;
};
