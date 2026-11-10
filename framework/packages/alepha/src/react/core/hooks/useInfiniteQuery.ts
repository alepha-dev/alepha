import type { Async } from "alepha";
import type { DurationLike } from "alepha/datetime";
import { type DependencyList, useCallback, useMemo, useRef } from "react";

import { QueryCache } from "../services/QueryCache.ts";
import type { QueryRetry } from "../utils/queryRetry.ts";
import type { ActionContext } from "./useAction.ts";
import { useAction } from "./useAction.ts";
import { useAlepha } from "./useAlepha.ts";
import { useQuery } from "./useQuery.ts";

/**
 * Hook for a list read page by page, every page loaded so far kept under one
 * cache key: a "load more" button, an infinite scroll.
 *
 * Built over {@link useQuery}: the entry under `key` is an
 * {@link InfiniteQueryData}, `{ pages, pageParams }`, so dedupe, `staleTime`,
 * `invalidates`, retries, the reconnect and tab-return refetches and
 * eviction apply to it with no second code path.
 *
 * One mechanism: `handler(ctx, pageParam)` reads one page,
 * `initialPageParam` is the first page's param, and `getNextPageParam(lastPage,
 * pages)` returns the next one, or `undefined` at the end. Offset and cursor
 * are two uses of it.
 *
 * @example By page, on a `Page<T>` from `paginate()`
 * ```tsx
 * const { pages, loadMore, hasMore, loadingMore } = useInfiniteQuery(
 *   {
 *     key: ["orders", userId],
 *     handler: ({ signal }, page: number) =>
 *       orderApi.list({ query: { page, size: 20 } }, { request: { signal } }),
 *     initialPageParam: 0,
 *     getNextPageParam: (last) =>
 *       last.page.isLast ? undefined : last.page.number + 1,
 *   },
 *   [userId],
 * );
 * const rows = pages.flatMap((page) => page.content);
 * ```
 *
 * @example By cursor
 * ```tsx
 * useInfiniteQuery(
 *   {
 *     key: ["inbox"],
 *     handler: (_ctx, cursor: string | undefined) =>
 *       inboxApi.list({ query: { cursor } }),
 *     initialPageParam: undefined,
 *     getNextPageParam: (last) => last.nextCursor,
 *   },
 *   [],
 * );
 * ```
 *
 * **A refetch reloads what is loaded.** After an invalidation, `refetch()`, a
 * reconnect or a tab-return refetch, the pages loaded so far are read again
 * in order, each param taken from the fresh previous page, stopping early if
 * the list got shorter, and the entry is written once at the end. A list with
 * 20 pages loaded sends 20 requests each time. A key change starts again from
 * the first page.
 *
 * An optimistic write needs no helper: `useQueryClient().setData(key, (data:
 * InfiniteQueryData<Page, Param>) => ({ ...data, pages: data.pages.map(...) }))`.
 */
export function useInfiniteQuery<Page, Param>(
  options: UseInfiniteQueryOptions<Page, Param>,
  deps: DependencyList,
): UseInfiniteQueryReturn<Page> {
  const alepha = useAlepha();
  const cache = useMemo(() => alepha.inject(QueryCache), [alepha]);
  const serializedKey = cache.serialize(options.key);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // How many pages were on screen for which key. An invalidation drops the
  // entry before the refetch runs, so the count is kept here, beside it, for
  // the refetch to reload as many pages as the reader had.
  const loadedRef = useRef<{ key: string; count: number } | undefined>(
    undefined,
  );

  const query = useQuery<InfiniteQueryData<Page, Param>>(
    {
      key: options.key,
      id: options.id,
      enabled: options.enabled,
      staleTime: options.staleTime,
      retry: options.retry,
      refetchOnFocus: options.refetchOnFocus,
      refetchOnReconnect: options.refetchOnReconnect,
      runEvery: options.runEvery,
      onError: options.onError,
      handler: async (context) => {
        const current = optionsRef.current;
        const key = cache.serialize(current.key);
        const entry = cache.get(current.key)?.data as
          | InfiniteQueryData<Page, Param>
          | undefined;
        const count =
          entry?.pages.length ??
          (loadedRef.current?.key === key ? loadedRef.current.count : 1);

        const pages: Page[] = [];
        const pageParams: Param[] = [];
        let param = current.initialPageParam;
        for (let index = 0; index < Math.max(count, 1); index++) {
          const page = await current.handler(context, param);
          pages.push(page);
          pageParams.push(param);
          const next = current.getNextPageParam(page, pages);
          if (next === undefined) {
            break;
          }
          param = next;
        }
        return { pages, pageParams };
      },
    },
    deps,
  );

  const pages = query.data?.pages ?? EMPTY;
  if (query.data) {
    loadedRef.current = { key: serializedKey, count: query.data.pages.length };
  }

  const nextParam = (data: InfiniteQueryData<Page, Param> | undefined) => {
    const last = data?.pages[data.pages.length - 1];
    return data && last !== undefined
      ? optionsRef.current.getNextPageParam(last, data.pages)
      : undefined;
  };
  const hasMore =
    query.data !== undefined && nextParam(query.data) !== undefined;

  // One page more, appended to the entry read when it lands. `useAction`'s
  // `run()` drops a call while one is in flight, so a double press sends one
  // request. A response that an invalidation overtook is dropped: the
  // refetch the invalidation started reloads the list.
  const more = useAction<[], void>(
    {
      id: options.id,
      onError: options.onError,
      handler: async (context) => {
        const key = optionsRef.current.key;
        const data = cache.get(key)?.data as
          | InfiniteQueryData<Page, Param>
          | undefined;
        const param = nextParam(data);
        if (!data || param === undefined) {
          return;
        }
        const generation = cache.generation(key);
        const page = await optionsRef.current.handler(context, param);
        if (context.signal.aborted || cache.generation(key) !== generation) {
          return;
        }
        const latest =
          (cache.get(key)?.data as
            | InfiniteQueryData<Page, Param>
            | undefined) ?? data;
        cache.set(key, {
          pages: [...latest.pages, page],
          pageParams: [...latest.pageParams, param],
        });
      },
    },
    [serializedKey],
  );

  const loadMore = useCallback(async () => {
    if (!hasMore) {
      return;
    }
    await more.run();
  }, [hasMore, more.run]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  return {
    pages,
    loadMore,
    hasMore,
    loadingMore: more.loading,
    loading: query.loading,
    error: query.error ?? more.error,
    refetch,
  };
}

const EMPTY: never[] = [];

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The cache entry of a {@link useInfiniteQuery}: the pages loaded so far, in
 * order, and the param each was read with.
 */
export interface InfiniteQueryData<Page, Param> {
  pages: Page[];
  pageParams: Param[];
}

export interface UseInfiniteQueryOptions<Page, Param> {
  /**
   * Cache key, required: every page loaded so far lives in one entry under
   * it. A change of key starts again from the first page.
   */
  key: unknown[];

  /**
   * Read one page. Receives the {@link ActionContext} and the page's param:
   * `initialPageParam` for the first, then what `getNextPageParam` returned.
   */
  handler: (context: ActionContext, pageParam: Param) => Async<Page>;

  /**
   * The param of the first page: `0` for a page number, `undefined` for a
   * cursor.
   */
  initialPageParam: Param;

  /**
   * The param of the page after `lastPage`, or `undefined` when there is none:
   * `last.page.isLast ? undefined : last.page.number + 1` on a `Page<T>`,
   * `last.nextCursor` on a cursor API.
   */
  getNextPageParam: (lastPage: Page, pages: Page[]) => Param | undefined;

  /**
   * See {@link UseQueryOptions.staleTime}.
   */
  staleTime?: DurationLike;

  /**
   * See {@link UseQueryOptions.enabled}.
   */
  enabled?: boolean;

  /**
   * See {@link UseQueryOptions.retry}. Applies to the first load and to a
   * refetch, which reloads every page in one attempt.
   */
  retry?: QueryRetry;

  /**
   * See {@link UseQueryOptions.refetchOnFocus}.
   */
  refetchOnFocus?: boolean;

  /**
   * See {@link UseQueryOptions.refetchOnReconnect}.
   */
  refetchOnReconnect?: boolean;

  /**
   * See {@link UseQueryOptions.runEvery}. Each tick reloads every page.
   */
  runEvery?: DurationLike;

  /**
   * See {@link UseQueryOptions.onError}. Also called when `loadMore()` fails.
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Identifier carried by the `react:action:*` events.
   */
  id?: string;
}

export interface UseInfiniteQueryReturn<Page> {
  /**
   * The pages loaded so far, in order; an empty array before the first one.
   */
  pages: Page[];

  /**
   * Read the next page and append it. Never rejects. A call while one is in
   * flight, or when `hasMore` is false, sends nothing.
   */
  loadMore: () => Promise<void>;

  /**
   * Whether `getNextPageParam` returned a param for the last page.
   */
  hasMore: boolean;

  /**
   * `true` only while `loadMore()` runs.
   */
  loadingMore: boolean;

  /**
   * `useQuery`'s `loading`: the first load and a refetch. It stays `false`
   * during `loadMore()`, so a list does not fall back to its skeleton when
   * the reader asks for more.
   */
  loading: boolean;

  /**
   * The error of the last failed load, refetch or `loadMore()`.
   */
  error?: Error;

  /**
   * Reload every page loaded so far. Never rejects.
   */
  refetch: () => Promise<void>;
}
