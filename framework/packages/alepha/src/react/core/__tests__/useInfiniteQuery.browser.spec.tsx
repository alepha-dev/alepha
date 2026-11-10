import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha, createPagination, type Page } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { describe, it, vi } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useInfiniteQuery } from "../hooks/useInfiniteQuery.ts";
import { useQueryClient } from "../hooks/useQueryClient.ts";
import { AlephaReact, type InfiniteQueryData, QueryCache } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
  await alepha.start();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );
  return { alepha, wrapper, cache: alepha.inject(QueryCache) };
};

interface Row {
  id: number;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: index + 1 }));

/**
 * A `paginate()`-shaped endpoint over `data`, `size` rows a page.
 */
const pagedApi = (data: () => Row[], size = 2) =>
  vi.fn(async (_ctx: unknown, page: number): Promise<Page<Row>> => {
    const all = data();
    return createPagination(
      all.slice(page * size, page * size + size + 1),
      size,
      page * size,
    );
  });

const byPage = (
  handler: ReturnType<typeof pagedApi>,
  key: unknown[] = ["rows"],
) => ({
  key,
  handler,
  initialPageParam: 0,
  getNextPageParam: (last: Page<Row>) =>
    last.page.isLast ? undefined : last.page.number + 1,
});

interface CursorPage {
  items: string[];
  nextCursor?: string;
}

describe("useInfiniteQuery", () => {
  it("reads a Page<T> from paginate() page by page, until page.isLast", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = pagedApi(() => rows(5));
    const { result } = renderHook(() => useInfiniteQuery(byPage(handler), []), {
      wrapper,
    });

    expect(result.current.pages).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());
    expect(result.current.pages.flatMap((page) => page.content)).toEqual(
      rows(5),
    );
    expect(result.current.hasMore).toBe(false);
    expect(handler.mock.calls.map((call) => call[1])).toEqual([0, 1, 2]);

    await act(() => result.current.loadMore());
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("reads by cursor through the same getNextPageParam, with no mode option", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(
      async (_ctx: unknown, cursor: string | undefined): Promise<CursorPage> =>
        cursor === undefined
          ? { items: ["a", "b"], nextCursor: "c1" }
          : { items: ["c"] },
    );
    const { result } = renderHook(
      () =>
        useInfiniteQuery(
          {
            key: ["inbox"],
            handler,
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (last) => last.nextCursor,
          },
          [],
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(() => result.current.loadMore());
    expect(result.current.pages.flatMap((page) => page.items)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(handler.mock.calls.map((call) => call[1])).toEqual([
      undefined,
      "c1",
    ]);
    expect(result.current.hasMore).toBe(false);
  });

  it("loadingMore is true only during loadMore(), and loading stays false then", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    let release: (() => void) | undefined;
    const handler = vi.fn(async (_ctx: unknown, page: number) => {
      if (page > 0) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return createPagination(
        rows(3).slice(page * 2, page * 2 + 3),
        2,
        page * 2,
      );
    });
    const { result } = renderHook(() => useInfiniteQuery(byPage(handler), []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadingMore).toBe(false);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.loading).toBe(false);

    // A second press while one is in flight sends nothing.
    await act(async () => {
      void result.current.loadMore();
    });
    expect(handler).toHaveBeenCalledTimes(2);

    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.pages).toHaveLength(2);
  });

  it("an invalidation and refetch() reload the pages loaded, in order, each from the fresh previous page, and write once", async ({
    expect,
  }) => {
    const { alepha, cache, wrapper } = await setup();
    let data = rows(6);
    const handler = pagedApi(() => data);
    const { result } = renderHook(() => useInfiniteQuery(byPage(handler), []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    await act(() => result.current.loadMore());
    expect(result.current.pages).toHaveLength(2);
    handler.mockClear();

    let writes = 0;
    alepha.events.on("state:mutated", ({ key }) => {
      if (key === "alepha.react.queryCache") {
        writes += 1;
      }
    });

    data = rows(6).map((row) => ({ id: row.id * 10 }));
    await act(async () => cache.invalidate(["rows"]));
    await waitFor(() =>
      expect(result.current.pages[0]?.content[0]).toEqual({ id: 10 }),
    );
    expect(handler.mock.calls.map((call) => call[1])).toEqual([0, 1]);
    expect(result.current.pages).toHaveLength(2);
    // One write for the invalidation, one for the reloaded entry.
    expect(writes).toBe(2);

    // The list got shorter: the reload stops at its new end.
    handler.mockClear();
    data = rows(1);
    await act(() => result.current.refetch());
    expect(handler.mock.calls.map((call) => call[1])).toEqual([0]);
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.hasMore).toBe(false);
  });

  it("a reconnect and a tab-return refetch reload the pages loaded", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = pagedApi(() => rows(6));
    const { result } = renderHook(
      () => useInfiniteQuery({ ...byPage(handler), refetchOnFocus: true }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    await act(() => result.current.loadMore());
    handler.mockClear();

    await act(async () => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(handler.mock.calls.map((call) => call[1])).toEqual([0, 1]);

    handler.mockClear();
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(result.current.pages).toHaveLength(2);
  });

  it("a key change starts again from the first page", async ({ expect }) => {
    const { wrapper } = await setup();
    const handler = pagedApi(() => rows(6));
    const { result, rerender } = renderHook(
      (props: { filter: string }) =>
        useInfiniteQuery(byPage(handler, ["rows", props.filter]), [
          props.filter,
        ]),
      { wrapper, initialProps: { filter: "a" } },
    );
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    await act(() => result.current.loadMore());
    expect(result.current.pages).toHaveLength(2);

    handler.mockClear();
    rerender({ filter: "b" });
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    expect(handler.mock.calls.map((call) => call[1])).toEqual([0]);
  });

  it("InfiniteQueryData is patched across pages with useQueryClient().setData", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = pagedApi(() => rows(4));
    const { result } = renderHook(
      () => ({
        list: useInfiniteQuery(byPage(handler), []),
        queries: useQueryClient(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.hasMore).toBe(true));
    await act(() => result.current.list.loadMore());

    act(() => {
      result.current.queries.setData<InfiniteQueryData<Page<Row>, number>>(
        ["rows"],
        (data) => ({
          ...data!,
          pages: data!.pages.map((page) => ({
            ...page,
            content: page.content.map((row) =>
              row.id === 3 ? { id: 33 } : row,
            ),
          })),
        }),
      );
    });
    expect(
      result.current.list.pages.flatMap((page) =>
        page.content.map((r) => r.id),
      ),
    ).toEqual([1, 2, 33, 4]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("a failing loadMore() never rejects and reports the error", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(async (_ctx: unknown, page: number) => {
      if (page > 0) {
        throw new Error("boom");
      }
      return createPagination(rows(3), 2, 0);
    });
    const { result } = renderHook(() => useInfiniteQuery(byPage(handler), []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(() => result.current.loadMore());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.pages).toHaveLength(1);
  });
});
