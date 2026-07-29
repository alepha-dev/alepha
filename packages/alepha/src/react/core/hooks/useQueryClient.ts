import { useCallback, useMemo } from "react";
import { QueryCache } from "../services/QueryCache.ts";
import { useInject } from "./useInject.ts";

/**
 * Imperative access to the query cache used by `useQuery`.
 *
 * Most invalidation should be declarative — `useAction({ invalidates })` —
 * because it keeps the write and the keys it affects in one place. Reach for
 * this hook when the trigger is not a `useAction`: a websocket message, a
 * router event, or an optimistic write applied before the request settles.
 *
 * ```tsx
 * const queries = useQueryClient();
 *
 * useEvents({
 *   "folio:updated": ({ campaignId }) => {
 *     queries.invalidate(["folios", campaignId]);
 *   },
 * }, []);
 * ```
 */
export function useQueryClient(): UseQueryClientReturn {
  const cache = useInject(QueryCache);

  const invalidate = useCallback(
    (key: unknown[]) => cache.invalidate(key),
    [cache],
  );

  const setData = useCallback(
    <T>(key: unknown[], updater: T | ((previous: T | undefined) => T)) => {
      const next =
        typeof updater === "function"
          ? (updater as (previous: T | undefined) => T)(
              cache.get(key)?.data as T | undefined,
            )
          : updater;
      cache.set(key, next);
    },
    [cache],
  );

  const get = useCallback(
    <T>(key: unknown[]) => cache.get(key)?.data as T | undefined,
    [cache],
  );

  const clear = useCallback(() => cache.clear(), [cache]);

  return useMemo(
    () => ({ invalidate, setData, get, clear }),
    [invalidate, setData, get, clear],
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export interface UseQueryClientReturn {
  /**
   * Drop every cached entry whose key starts with `key`. Mounted queries under
   * that prefix refetch.
   */
  invalidate: (key: unknown[]) => void;

  /**
   * Write a value into the cache directly, without a fetch. Pass a function to
   * derive the next value from the current one — that is the optimistic-update
   * shape.
   */
  setData: <T>(
    key: unknown[],
    updater: T | ((previous: T | undefined) => T),
  ) => void;

  /**
   * Read a cached value without subscribing to it.
   */
  get: <T>(key: unknown[]) => T | undefined;

  /**
   * Drop every cached entry. Mostly useful on logout, where keeping another
   * user's data in memory would be a leak.
   */
  clear: () => void;
}
