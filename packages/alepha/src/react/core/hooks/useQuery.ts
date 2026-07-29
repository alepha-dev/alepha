import type { Async } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import {
  type DependencyList,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { queryCacheAtom } from "../atoms/queryCacheAtom.ts";
import { QueryCache } from "../services/QueryCache.ts";
import type { ActionContext } from "./useAction.ts";
import { useAction } from "./useAction.ts";
import { useAlepha } from "./useAlepha.ts";
import { useInject } from "./useInject.ts";
import { useSelector } from "./useSelector.ts";

/**
 * Hook for declarative data fetching with automatic execution and refetch.
 *
 * Thin wrapper over {@link useAction}: it pre-applies `runOnInit: true`,
 * exposes the last result as `data`, and provides a stable `refetch()` to
 * re-run the query on demand. For optimistic mutations and side-effects,
 * use {@link useAction} directly — `useQuery` is for the read path.
 *
 * Request deduplication and AbortSignal cancellation come from `useAction` +
 * `HttpClient`.
 *
 * Pass a `key` to opt into the shared query cache: components using the same
 * key read one entry rather than each fetching, `staleTime` serves a fresh
 * entry without hitting the network, and a mutation declaring
 * `invalidates: [["folios"]]` drops every entry under that prefix and makes
 * mounted queries refetch. The cache lives in a registered atom, so
 * server-rendered results hydrate on the client for free.
 *
 * Without a `key`, none of that applies and the hook behaves exactly as it
 * always has — no cache reads, no cache writes, no shared state.
 *
 * @example Basic
 * ```tsx
 * const client = useInject(HttpClient);
 * const { data, loading, error, refetch } = useQuery({
 *   handler: async ({ signal }) => {
 *     const res = await client.fetch("/api/users", { signal });
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
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);

  // Resolved only when the caller opts into caching. Injecting it
  // unconditionally would make every `useQuery` require the react module to be
  // loaded, which would break keyless call sites that work today.
  const keyed = options.key !== undefined;
  const cache = useMemo(
    () => (keyed ? alepha.inject(QueryCache) : undefined),
    [alepha, keyed],
  );

  // Keyless queries keep their original behaviour exactly: no cache reads, no
  // cache writes, no shared state. Everything below is inert when `key` is
  // absent, so existing call sites are unaffected.
  const serializedKey =
    options.key && cache ? cache.serialize(options.key) : undefined;

  // Subscribe to this key's slice only, so a write to another key does not
  // re-render here. `useSelector` returns a referentially stable value for an
  // unchanged slice, which is what keeps `useSyncExternalStore` quiet.
  const entry = useSelector(queryCacheAtom, (state) =>
    serializedKey ? state?.[serializedKey] : undefined,
  );

  const [localData, setLocalData] = useState<Result | undefined>(
    options.initialData,
  );
  // The deduped handler is built once per key; read the caller's latest
  // handler through a ref so it never closes over a stale render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Tracks whether the auto-run has completed at least once, so we can keep
  // `loading` true on the very first render — before `runOnInit`'s effect
  // fires — instead of briefly reporting `loading: false` with no data.
  const settledRef = useRef(false);
  // Last value rendered for a *previous* key, retained across a key change so
  // `keepPreviousData` can render it while the new key loads.
  const previousDataRef = useRef<Result | undefined>(undefined);

  const cached = serializedKey
    ? (entry?.data as Result | undefined)
    : undefined;
  const staleTimeMs = options.staleTime
    ? dateTime.duration(options.staleTime).asMilliseconds()
    : 0;
  const isFresh =
    entry !== undefined &&
    staleTimeMs > 0 &&
    dateTime.nowMillis() - entry.updatedAt < staleTimeMs;

  // A fresh cache hit means the initial fetch is skipped entirely — that is
  // the point of `staleTime`. Invalidation removes the entry, which flips
  // this back to true and re-runs the effect below.
  const shouldRun = enabled && !isFresh;

  const action = useAction<[], Result>(
    {
      id: options.id,
      // Keyed queries route through the cache's in-flight map, so two
      // components mounting on the same key in one tick share a single
      // request instead of both missing the not-yet-populated cache.
      handler: options.key
        ? (context) =>
            cache!.dedupe(options.key!, async () =>
              optionsRef.current.handler(context),
            )
        : options.handler,
      runOnInit: shouldRun,
      runEvery: options.runEvery,
      debounce: options.debounce,
      onError: options.onError,
      onSuccess: async (result) => {
        settledRef.current = true;
        if (options.key && cache) {
          cache.set(options.key, result);
        } else {
          setLocalData(result);
        }
        if (options.onSuccess) {
          await options.onSuccess(result);
        }
      },
    },
    // A key change is a dependency change: re-run for the new key.
    serializedKey ? [...deps, serializedKey] : deps,
  );

  const refetch = useCallback(() => action.refetch(), [action.refetch]);

  // Refetch when the entry we were rendering is invalidated out from under us.
  // Gated on a defined → undefined transition so the initial mount (which has
  // no entry yet) does not double-fire alongside `runOnInit`.
  const hadEntryRef = useRef(false);
  useEffect(() => {
    if (!serializedKey || !enabled) {
      return;
    }
    if (hadEntryRef.current && entry === undefined) {
      hadEntryRef.current = false;
      void action.refetch();
      return;
    }
    hadEntryRef.current = entry !== undefined;
  }, [entry, serializedKey, enabled, action.refetch]);

  const data = serializedKey
    ? (cached ??
      (options.keepPreviousData ? previousDataRef.current : undefined))
    : localData;

  if (serializedKey && cached !== undefined) {
    previousDataRef.current = cached;
  }

  // `loading` is true while a fetch is in flight, AND during the initial gap
  // between first render and the auto-run effect — so consumers can render a
  // skeleton immediately instead of flashing an empty/not-found state. A
  // cache hit settles it immediately: there is nothing to wait for.
  const loading =
    action.loading ||
    (shouldRun &&
      cached === undefined &&
      options.initialData === undefined &&
      !settledRef.current &&
      action.error === undefined);

  return {
    data: data ?? options.initialData,
    loading,
    error: action.error,
    refetch,
    cancel: action.cancel,
    isStale: entry !== undefined && !isFresh,
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
   * Cache key. Opt-in — omit it and the hook keeps its uncached behaviour.
   *
   * Keys are arrays so they compose: `["folios", campaignId]`. Invalidation
   * matches by prefix, so a mutation can drop `["folios"]` without knowing
   * every campaign id that was queried.
   */
  key?: unknown[];

  /**
   * How long a cached entry stays fresh. While fresh, mounting the query
   * renders from cache without fetching. Defaults to `0` — always revalidate.
   */
  staleTime?: DurationLike;

  /**
   * Keep rendering the previous key's data while a new key loads, instead of
   * dropping to `undefined`. Useful for pagination and filters, where a blank
   * frame between pages reads as a bug. Requires `key`.
   */
  keepPreviousData?: boolean;

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

  /**
   * True when a cached entry exists but has outlived `staleTime`, so the
   * rendered `data` is being revalidated in the background. Always false for
   * keyless queries.
   */
  isStale: boolean;
}
