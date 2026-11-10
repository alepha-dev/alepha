import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { ReactAuthQueryReset } from "alepha/react/auth";
import { currentUserAtom } from "alepha/security";
import { describe, it, vi } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useQuery } from "../hooks/useQuery.ts";
import {
  AlephaReact,
  QueryCache,
  queryCacheAtom,
  queryOptionsAtom,
} from "../index.ts";

const setup = async (configure?: (alepha: Alepha) => void) => {
  const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
  configure?.(alepha);
  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  await alepha.start();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );
  return { alepha, dateTime, wrapper, cache: alepha.inject(QueryCache) };
};

const MINUTE = 60_000;

describe("QueryCache eviction", () => {
  it("drops an entry 5 minutes after its last observer left, by default", async ({
    expect,
  }) => {
    const { cache, dateTime, wrapper } = await setup();
    const { unmount } = renderHook(
      () => useQuery({ key: ["k"], handler: async () => "v" }, []),
      { wrapper },
    );
    await waitFor(() => expect(cache.get(["k"])?.data).toBe("v"));

    // Mounted: never evicted, however long.
    await act(() => dateTime.travel(10 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");

    unmount();
    await act(() => dateTime.travel(4 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");
    await act(() => dateTime.travel(1 * MINUTE + 1));
    expect(cache.get(["k"])).toBe(undefined);
  });

  it("gcTime: false keeps entries for the life of the page", async ({
    expect,
  }) => {
    const { cache, dateTime } = await setup((alepha) =>
      alepha.store.mut(queryOptionsAtom, (options) => ({
        ...options,
        gcTime: false as const,
      })),
    );
    cache.set(["k"], "v");
    await act(() => dateTime.travel(24 * 60 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");
  });

  it("never drops an entry before its staleTime has run out: remounted after 6 of 10 minutes, it renders from cache", async ({
    expect,
  }) => {
    const { cache, dateTime, wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    const options = {
      key: ["k"],
      handler,
      staleTime: [10, "minutes"] as [number, "minutes"],
    };
    const first = renderHook(() => useQuery(options, []), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBe("v"));
    first.unmount();

    await act(() => dateTime.travel(6 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");

    const second = renderHook(() => useQuery(options, []), { wrapper });
    expect(second.result.current.data).toBe("v");
    expect(second.result.current.loading).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    second.unmount();

    // Left at 6 minutes, written at 0, staleTime 10: dropped at 11 (6 + 5).
    // (A timer travel() leaves short of its expiry runs on the real clock, so
    // the margins here are whole minutes.)
    await act(() => dateTime.travel(4 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");
    await act(() => dateTime.travel(2 * MINUTE));
    expect(cache.get(["k"])).toBe(undefined);
  });

  it("an entry that never had an observer is dropped gcTime after it was written", async ({
    expect,
  }) => {
    const { cache, dateTime } = await setup();
    cache.set(["written"], 1);
    await act(() => dateTime.travel(3 * MINUTE));
    cache.set(["written"], 2);
    await act(() => dateTime.travel(4 * MINUTE));
    expect(cache.get(["written"])?.data).toBe(2);
    await act(() => dateTime.travel(1 * MINUTE + 1));
    expect(cache.get(["written"])).toBe(undefined);
  });

  it("drops a hydrated entry gcTime after it was written, unless a query mounts on it", async ({
    expect,
  }) => {
    const { cache, dateTime } = await setup((alepha) => {
      const now = alepha.inject(DateTimeProvider).nowMillis();
      alepha.store.set(queryCacheAtom, {
        '["hydrated"]': { data: "h", updatedAt: now },
      });
    });
    expect(cache.get(["hydrated"])?.data).toBe("h");
    await act(() => dateTime.travel(5 * MINUTE + 1));
    expect(cache.get(["hydrated"])).toBe(undefined);
  });

  it("a remount before the delay cancels the timer, and eviction forgets the key's generation", async ({
    expect,
  }) => {
    const { cache, dateTime, wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    const first = renderHook(() => useQuery({ key: ["k"], handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.data).toBe("v"));
    first.unmount();
    await act(() => dateTime.travel(4 * MINUTE));

    const second = renderHook(() => useQuery({ key: ["k"], handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await act(() => dateTime.travel(10 * MINUTE));
    expect(cache.get(["k"])?.data).toBe("v");
    second.unmount();

    const generations = (
      cache as unknown as { generations: Map<string, number> }
    ).generations;
    expect(generations.has('["k"]')).toBe(true);
    await act(() => dateTime.travel(5 * MINUTE + 1));
    expect(cache.get(["k"])).toBe(undefined);
    expect(generations.has('["k"]')).toBe(false);
  });
});

describe("QueryCache on a change of signed-in user", () => {
  const setupAuth = () =>
    setup((alepha) => {
      alepha.with(ReactAuthQueryReset);
      alepha.store.set(currentUserAtom, { id: "u1" } as never);
    });

  it("a sign-out empties the cache, and no mounted query refetches", async ({
    expect,
  }) => {
    const { alepha, cache, wrapper } = await setupAuth();
    const handler = vi.fn(async () => "private");
    const { result } = renderHook(
      () => useQuery({ key: ["me"], handler }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe("private"));
    cache.set(["other"], "x");

    await act(async () => {
      alepha.store.set(currentUserAtom, undefined);
    });
    expect(cache.get(["me"])).toBe(undefined);
    expect(cache.get(["other"])).toBe(undefined);
    expect(result.current.data).toBe(undefined);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a switch of user empties the cache, and mounted queries re-run", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await setupAuth();
    let user = "u1";
    const handler = vi.fn(async () => user);
    const { result } = renderHook(
      () => useQuery({ key: ["me"], handler }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe("u1"));

    user = "u2";
    await act(async () => {
      alepha.store.set(currentUserAtom, { id: "u2" } as never);
    });
    await waitFor(() => expect(result.current.data).toBe("u2"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("the same user set again changes nothing", async ({ expect }) => {
    const { alepha, cache } = await setupAuth();
    cache.set(["k"], "v");
    alepha.store.set(currentUserAtom, { id: "u1", name: "renamed" } as never);
    expect(cache.get(["k"])?.data).toBe("v");
  });

  it("useQueryClient's clear() still makes mounted queries refetch", async ({
    expect,
  }) => {
    const { cache, wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    renderHook(() => useQuery({ key: ["k"], handler }, []), { wrapper });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(async () => cache.clear());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });
});
