import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { describe, test, vi } from "vitest";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";
import { useQuery } from "../hooks/useQuery.ts";
import { AlephaReact } from "../index.ts";

describe("useQuery", () => {
  test("runs on mount and exposes data/loading/error/refetch", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => ({ users: ["a", "b"] }));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(() => useQuery({ handler }, []), { wrapper });

    expect(result.current.data).toBe(undefined);
    expect(typeof result.current.refetch).toBe("function");

    await waitFor(() => {
      expect(result.current.data).toEqual({ users: ["a", "b"] });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(undefined);

    // refetch
    handler.mockResolvedValueOnce({ users: ["c"] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual({ users: ["c"] });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("reports loading on the first render, before the fetch settles", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => "value");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(() => useQuery({ handler }, []), { wrapper });

    // No data yet, but loading must already be true so callers can render a
    // skeleton instead of an empty/not-found flash.
    expect(result.current.data).toBe(undefined);
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBe("value");
    });
    expect(result.current.loading).toBe(false);
  });

  test("does not run when enabled is false", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => "value");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useQuery({ handler, enabled: false }, []),
      { wrapper },
    );

    // give it a tick to ensure no spontaneous run
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).not.toHaveBeenCalled();
    expect(result.current.data).toBe(undefined);
  });

  test("fetches when enabled flips from false to true", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => "value");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    // The common gate pattern: `enabled: !!userId` — the query must start
    // the moment the gate opens, not stay a skeleton forever.
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useQuery({ handler, enabled }, []),
      { wrapper, initialProps: { enabled: false } },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.data).toBe("value");
    });
    expect(result.current.loading).toBe(false);
  });

  test("refetch supersedes an in-flight request", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const resolvers: Array<(v: string) => void> = [];
    const handler = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(() => useQuery({ handler }, []), { wrapper });

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    // refetch while the first request is still pending — the docs promise the
    // in-flight request is aborted and a new one starts, not a silent no-op.
    let refetched: Promise<unknown> = Promise.resolve();
    act(() => {
      refetched = result.current.refetch();
    });

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolvers[1]("fresh");
      await refetched;
    });
    expect(result.current.data).toBe("fresh");

    // The superseded first request must never win.
    await act(async () => {
      resolvers[0]("stale");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.data).toBe("fresh");
  });

  test("supports initialData", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => "fetched");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useQuery({ handler, initialData: "seed" }, []),
      { wrapper },
    );

    expect(result.current.data).toBe("seed");

    await waitFor(() => {
      expect(result.current.data).toBe("fetched");
    });
  });

  /**
   * The concurrency guard used to bail out BEFORE the abort-previous block, so
   * a dep that changed while a request was in flight never triggered a refetch:
   * the stale user's data committed and stayed forever.
   */
  test("refetches when a dep changes mid-flight and commits the newest result", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const release: Record<string, () => void> = {};
    const handler = vi.fn(
      (userId: string) =>
        new Promise<string>((resolve) => {
          release[userId] = () => resolve(`data-for-${userId}`);
        }),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result, rerender } = renderHook(
      ({ userId }) => useQuery({ handler: () => handler(userId) }, [userId]),
      { wrapper, initialProps: { userId: "alice" } },
    );

    // alice's request is in flight (never resolved yet).
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(result.current.data).toBe(undefined);

    // The dep changes while alice is still in flight.
    rerender({ userId: "bob" });

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

    // Now let both finish — alice (superseded) first, then bob.
    await act(async () => {
      release.alice?.();
      release.bob?.();
    });

    await waitFor(() => {
      expect(result.current.data).toBe("data-for-bob");
    });
  });
});

describe("useQuery keyed cache", () => {
  test("shares data between two components on the same key", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    const handler = vi.fn(async () => "Alpha");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const useBoth = () => {
      const a = useQuery({ key: ["folio", 1], handler }, []);
      const b = useQuery({ key: ["folio", 1], handler }, []);
      return { a, b };
    };

    const { result } = renderHook(useBoth, { wrapper });

    await waitFor(() => {
      expect(result.current.a.data).toBe("Alpha");
      expect(result.current.b.data).toBe("Alpha");
    });

    // Both hooks read the one cached entry rather than each fetching.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("serves cached data within staleTime instead of refetching", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    let calls = 0;
    const handler = async () => `v${++calls}`;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const first = renderHook(
      () =>
        useQuery({ key: ["folio", 2], handler, staleTime: [1, "minute"] }, []),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.data).toBe("v1"));
    first.unmount();

    const second = renderHook(
      () =>
        useQuery({ key: ["folio", 2], handler, staleTime: [1, "minute"] }, []),
      { wrapper },
    );

    // Fresh entry → rendered from cache on the very first render, no fetch.
    expect(second.result.current.data).toBe("v1");
    expect(second.result.current.loading).toBe(false);
    expect(calls).toBe(1);
  });

  test("refetches when a mutation invalidates the key", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    let calls = 0;
    const handler = async () => `v${++calls}`;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const useBoth = () => {
      const query = useQuery({ key: ["folio", 3], handler }, []);
      const mutate = useAction(
        { handler: async () => "written", invalidates: [["folio"]] },
        [],
      );
      return { query, mutate };
    };

    const { result } = renderHook(useBoth, { wrapper });

    await waitFor(() => expect(result.current.query.data).toBe("v1"));

    await act(async () => {
      await result.current.mutate.run();
    });

    await waitFor(() => expect(result.current.query.data).toBe("v2"));
    expect(calls).toBe(2);
  });
});
