import type { Async } from "alepha";
import type { DurationLike } from "alepha/datetime";
import { type DependencyList, useCallback, useRef, useState } from "react";
import type { ActionContext } from "./useAction.ts";
import { useAction } from "./useAction.ts";

/**
 * Hook for declarative data fetching with automatic execution and refetch.
 *
 * Thin wrapper over {@link useAction}: it pre-applies `runOnInit: true`,
 * exposes the last result as `data`, and provides a stable `refetch()` to
 * re-run the query on demand. For optimistic mutations and side-effects,
 * use {@link useAction} directly — `useQuery` is for the read path.
 *
 * Caching, request deduplication, and AbortSignal cancellation come from
 * `useAction` + `HttpClient`. There is no separate cache layer — pass
 * `localCache` to your `HttpClient.fetch()`/`fetchAction()` call inside
 * the query handler if you want per-call caching.
 *
 * @example Basic
 * ```tsx
 * const client = useInject(HttpClient);
 * const { data, loading, error, refetch } = useQuery({
 *   handler: async ({ signal }) => {
 *     const res = await client.fetch("/api/users", { request: { signal } });
 *     return res.data;
 *   },
 * }, []);
 * ```
 *
 * @example Re-fetch when a dep changes
 * ```tsx
 * const { data } = useQuery({
 *   handler: async () => api.getUser(userId),
 * }, [userId]);
 * ```
 *
 * @example Polling
 * ```tsx
 * const { data } = useQuery({
 *   handler: async () => api.getStatus(),
 *   runEvery: [5, "seconds"],
 * }, []);
 * ```
 */
export function useQuery<Result>(
  options: UseQueryOptions<Result>,
  deps: DependencyList,
): UseQueryReturn<Result> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<Result | undefined>(options.initialData);
  // Tracks whether the auto-run has completed at least once, so we can keep
  // `loading` true on the very first render — before `runOnInit`'s effect
  // fires — instead of briefly reporting `loading: false` with no data.
  const settledRef = useRef(false);

  const action = useAction<[], Result>(
    {
      id: options.id,
      handler: options.handler,
      runOnInit: enabled,
      runEvery: options.runEvery,
      debounce: options.debounce,
      onError: options.onError,
      onSuccess: async (result) => {
        settledRef.current = true;
        setData(result);
        if (options.onSuccess) {
          await options.onSuccess(result);
        }
      },
    },
    deps,
  );

  const refetch = useCallback(() => action.run(), [action.run]);

  // `loading` is true while a fetch is in flight, AND during the initial gap
  // between first render and the auto-run effect — so consumers can render a
  // skeleton immediately instead of flashing an empty/not-found state. Only
  // applies to enabled queries with no `initialData` seed; an error settles
  // it (the error path keeps the caller's `onError` re-throw semantics).
  const loading =
    action.loading ||
    (enabled &&
      options.initialData === undefined &&
      !settledRef.current &&
      action.error === undefined);

  return {
    data,
    loading,
    error: action.error,
    refetch,
    cancel: action.cancel,
  };
}

// ---------------------------------------------------------------------------------------------------------------------

export interface UseQueryOptions<Result> {
  /**
   * Async query handler. Receives an {@link ActionContext} with an
   * AbortSignal that fires on unmount, dependency change, or `cancel()`.
   */
  handler: (context: ActionContext) => Async<Result>;

  /**
   * Optional identifier (used in lifecycle events for debugging/analytics).
   */
  id?: string;

  /**
   * If `false`, skip automatic execution on mount and dep change. Use
   * `refetch()` to trigger manually. Defaults to `true`.
   */
  enabled?: boolean;

  /**
   * Initial value for `data` before the first successful fetch.
   */
  initialData?: Result;

  /**
   * Re-run periodically. See {@link useAction} `runEvery`.
   */
  runEvery?: DurationLike;

  /**
   * Debounce delay in milliseconds. See {@link useAction} `debounce`.
   */
  debounce?: number;

  /**
   * Called on success with the resolved value.
   */
  onSuccess?: (result: Result) => void | Promise<void>;

  /**
   * Custom error handler. If provided, prevents default error re-throw.
   */
  onError?: (error: Error) => void | Promise<void>;
}

export interface UseQueryReturn<Result> {
  /**
   * The last successful result. `undefined` until the first fetch resolves
   * (or the value of `initialData` if provided).
   */
  data: Result | undefined;

  /**
   * Loading state — `true` while a fetch is in flight, and also from the
   * first render until the initial auto-run settles (for enabled queries
   * with no `initialData`), so a skeleton can render without a flash.
   */
  loading: boolean;

  /**
   * Error from the last failed fetch, if any.
   */
  error?: Error;

  /**
   * Re-run the query. The previous in-flight request, if any, is aborted.
   */
  refetch: () => Promise<Result | undefined>;

  /**
   * Abort the in-flight request without scheduling another.
   */
  cancel: () => void;
}
