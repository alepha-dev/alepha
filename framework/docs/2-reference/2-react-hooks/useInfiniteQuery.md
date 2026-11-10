# useInfiniteQuery

## Import

```typescript
import { useInfiniteQuery } from "alepha/react";
```

## Overview

Hook for a list read page by page, every page loaded so far kept under one
cache key: a "load more" button, an infinite scroll.

Built over `useQuery`: the entry under `key` is an
`InfiniteQueryData`, `{ pages, pageParams }`, so dedupe, `staleTime`,
`invalidates`, retries, the reconnect and tab-return refetches and
eviction apply to it with no second code path.

One mechanism: `handler(ctx, pageParam)` reads one page,
`initialPageParam` is the first page's param, and `getNextPageParam(lastPage,
pages)` returns the next one, or `undefined` at the end. Offset and cursor
are two uses of it.

## Examples

By page, on a `Page<T>` from `paginate()`

```tsx
const { pages, loadMore, hasMore, loadingMore } = useInfiniteQuery(
  {
    key: ["orders", userId],
    handler: ({ signal }, page: number) =>
      orderApi.list({ query: { page, size: 20 } }, { request: { signal } }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.page.isLast ? undefined : last.page.number + 1,
  },
  [userId],
);
const rows = pages.flatMap((page) => page.content);
```

By cursor

```tsx
useInfiniteQuery(
  {
    key: ["inbox"],
    handler: (_ctx, cursor: string | undefined) =>
      inboxApi.list({ query: { cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor,
  },
  [],
);
```

**A refetch reloads what is loaded.** After an invalidation, `refetch()`, a
reconnect or a tab-return refetch, the pages loaded so far are read again
in order, each param taken from the fresh previous page, stopping early if
the list got shorter, and the entry is written once at the end. A list with
20 pages loaded sends 20 requests each time. A key change starts again from
the first page.

An optimistic write needs no helper: `useQueryClient().setData(key, (data:
InfiniteQueryData<Page, Param>) => ({ ...data, pages: data.pages.map(...) }))`.
