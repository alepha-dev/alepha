import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha, TimeoutError } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { HttpError } from "alepha/server";
import { describe, test, vi } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";
import { useQuery } from "../hooks/useQuery.ts";
import { AlephaReact, isRetryableError, queryOptionsAtom } from "../index.ts";
import { QueryCache } from "../services/QueryCache.ts";

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

  test("does not poll while enabled is false, and polls once it is", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const handler = vi.fn(async () => "value");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    // `enabled: !!id` with polling: while the gate is shut, the interval must
    // not fire either, or every tick requests the missing id.
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useQuery({ handler, enabled, runEvery: 10 }, []),
      { wrapper, initialProps: { enabled: false } },
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
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

  /**
   * A key that changes while the cache does not. `useSelector` used to keep
   * the slice it had selected for the previous key until the cache atom next
   * mutated, so the new key rendered the old key's data - and, under a
   * `staleTime`, took that entry as fresh and never fetched at all.
   */
  test("reads and fetches the new entry when the key changes", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    const handler = vi.fn(async (id: number) => `folio-${id}`);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result, rerender } = renderHook(
      (props: { id: number }) =>
        useQuery(
          {
            key: ["folio-by-id", props.id],
            handler: () => handler(props.id),
            staleTime: [1, "minute"],
          },
          [props.id],
        ),
      { wrapper, initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.data).toBe("folio-1"));

    rerender({ id: 2 });

    expect(result.current.data).not.toBe("folio-1");
    await waitFor(() => expect(result.current.data).toBe("folio-2"));
    expect(handler).toHaveBeenCalledTimes(2);
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

  test("an invalidation of a fresh entry sends one request, not two", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    const handler = vi.fn(async () => handler.mock.calls.length);
    const { result } = renderHook(
      () => useQuery({ key: ["fresh"], handler, staleTime: [1, "minute"] }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => alepha.inject(QueryCache).invalidate(["fresh"]));
    await waitFor(() => expect(result.current.data).toBe(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  /**
   * The cache atom declared its record keys as `z.text()`, which caps at 255
   * characters, so a key that serialized past that failed every write with
   * "Invalid key in record" and the query settled on that error instead of
   * its data. A file viewer keyed on a long worktree path hit it.
   */
  test("resolves a key that serializes past 255 characters", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    const worktree = `/Users/someone/git/project/.claude/worktrees/${"w".repeat(120)}`;
    const key = ["file", 42, worktree, `${worktree}/src/index.ts`, 1];
    expect(alepha.inject(QueryCache).serialize(key).length).toBeGreaterThan(
      255,
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useQuery({ key, handler: async () => "contents" }, []),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(undefined);
    expect(result.current.data).toBe("contents");
  });

  /**
   * A second run started on a KEYED query while the first is still in flight.
   *
   * The second run SUPERSEDES: it aborts the first's controller before
   * calling the handler. `QueryCache.dedupe` then handed it the very promise
   * it had just cancelled, so a handler that honours its abort signal
   * rejected once for both runs and the query settled with `loading: false`
   * and no data at all.
   */
  describe("a superseding run on a keyed query", () => {
    /**
     * A handler whose every call is resolved by hand, and which rejects with
     * an `AbortError` the moment its signal fires - i.e. one that honours
     * cancellation, which is the condition for the bug.
     */
    const deferredHandler = () => {
      const calls: Array<{ resolve: () => void }> = [];
      const handler = vi.fn(
        (context?: { signal?: AbortSignal }) =>
          new Promise<string>((resolve, reject) => {
            const index = calls.length + 1;
            calls.push({ resolve: () => resolve(`run-${index}`) });
            context?.signal?.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            );
          }),
      );
      return { handler, calls };
    };

    test("settles with the newest run's data, not empty", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
      await alepha.start();

      const { handler, calls } = deferredHandler();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AlephaContext.Provider value={alepha}>
          {children}
        </AlephaContext.Provider>
      );

      const { result } = renderHook(
        () => useQuery({ key: ["users"], handler }, []),
        { wrapper },
      );

      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => calls[0].resolve());
      await waitFor(() => expect(result.current.data).toBe("run-1"));

      // Two refetches back to back: the second supersedes the first, which is
      // still in flight.
      await act(async () => {
        void result.current.refetch();
        void result.current.refetch();
      });

      await waitFor(() => expect(calls).toHaveLength(3));
      await act(async () => calls[2].resolve());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBe("run-3");
      expect(result.current.error).toBe(undefined);
    });

    test("does not join a request that was already cancelled", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
      await alepha.start();
      const cache = alepha.inject(QueryCache);

      const first = new AbortController();
      const firstPromise = cache.dedupe(["k"], () => new Promise(() => {}), {
        signal: first.signal,
      });
      void firstPromise.catch(() => {});

      first.abort();

      let secondRan = false;
      const second = cache.dedupe(["k"], async () => {
        secondRan = true;
        return "ok";
      });

      expect(await second).toBe("ok");
      expect(secondRan).toBe(true);
    });
  });

  /**
   * Two components on one key share one request. The request used to carry
   * the FIRST component's signal, so unmounting it aborted the request the
   * second one was waiting on, and the survivor settled with no data.
   */
  test("keeps a shared request alive when the first of two components unmounts", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();

    let release: (value: string) => void = () => {};
    let aborted = false;
    const handler = vi.fn(
      (context?: { signal?: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          release = resolve;
          context?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const first = renderHook(
      () => useQuery({ key: ["shared", 1], handler }, []),
      { wrapper },
    );
    const second = renderHook(
      () => useQuery({ key: ["shared", 1], handler }, []),
      { wrapper },
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    first.unmount();
    await act(async () => release("Alpha"));

    await waitFor(() => expect(second.result.current.data).toBe("Alpha"));
    expect(aborted).toBe(false);
    expect(second.result.current.error).toBe(undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  /**
   * An invalidation that lands while the FIRST fetch of a key is in flight.
   * There was no entry to remove, so nothing refetched, and the pre-mutation
   * response was written into the cache afterwards.
   */
  test("does not cache a response that an invalidation overtook, and refetches", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();
    const cache = alepha.inject(QueryCache);

    const pending: Array<(value: string) => void> = [];
    const handler = vi.fn(
      () => new Promise<string>((resolve) => pending.push(resolve)),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useQuery({ key: ["folio", 9], handler }, []),
      { wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => cache.invalidate(["folio"]));
    await act(async () => pending[0]("before-write"));

    // The stale response is never stored: the hook asked again.
    expect(cache.get(["folio", 9])).toBe(undefined);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]("after-write"));

    await waitFor(() => expect(result.current.data).toBe("after-write"));
    expect(cache.get(["folio", 9])?.data).toBe("after-write");
  });

  test("does not let a component mounting after an invalidation join the stale request", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();
    const cache = alepha.inject(QueryCache);

    const pending: Array<(value: string) => void> = [];
    const handler = vi.fn(
      () => new Promise<string>((resolve) => pending.push(resolve)),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    renderHook(() => useQuery({ key: ["folio", 10], handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => cache.invalidate(["folio", 10]));

    const late = renderHook(
      () => useQuery({ key: ["folio", 10], handler }, []),
      { wrapper },
    );
    // A request of its own, issued after the write.
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[0]("before-write");
      pending[1]("after-write");
    });
    await waitFor(() => expect(late.result.current.data).toBe("after-write"));
  });
});

describe("useQuery retry", () => {
  const setup = async (configure?: (alepha: Alepha) => void) => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    configure?.(alepha);
    await alepha.start();
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const errors: Error[] = [];
    alepha.events.on("react:action:error", ({ error }) => {
      errors.push(error);
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    return { alepha, dateTime, errors, wrapper };
  };

  const unavailable = () => new HttpError({ status: 503 }, { message: "down" });

  test("tries a 503 three times by default, 1 s then 2 s apart", async ({
    expect,
  }) => {
    const { dateTime, errors, wrapper } = await setup();
    const handler = vi.fn(async () => {
      throw unavailable();
    });

    const { result } = renderHook(() => useQuery({ handler }, []), {
      wrapper,
    });

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);
    await act(() => dateTime.travel(1250));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(undefined);
    await act(() => dateTime.travel(2500));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(3));

    await waitFor(() => expect(result.current.error?.message).toBe("down"));
    expect(result.current.loading).toBe(false);
    expect(errors).toHaveLength(1);

    await act(() => dateTime.travel(60_000));
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("succeeds on a retry, with no error ever shown", async ({ expect }) => {
    const { dateTime, errors, wrapper } = await setup();
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError("Failed to fetch");
      }
      return "value";
    });

    const { result } = renderHook(() => useQuery({ handler }, []), {
      wrapper,
    });

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(() => dateTime.travel(1250));
    await waitFor(() => expect(result.current.data).toBe("value"));
    expect(result.current.error).toBe(undefined);
    expect(errors).toHaveLength(0);
  });

  test("retries a network failure, a 408, 502, 503, 504 and a TimeoutError", async ({
    expect,
  }) => {
    for (const make of [
      () => new TypeError("Failed to fetch"),
      () => new HttpError({ status: 408 }, { message: "x" }),
      () => new HttpError({ status: 502 }, { message: "x" }),
      () => new HttpError({ status: 503 }, { message: "x" }),
      () => new HttpError({ status: 504 }, { message: "x" }),
      () => new TimeoutError({ timeout: 1000 }),
    ]) {
      expect(isRetryableError(make())).toBe(true);
    }
  });

  test("never retries an abort, a 4xx, a 429, a 500 or a plain Error", async ({
    expect,
  }) => {
    for (const make of [
      () => new DOMException("aborted", "AbortError"),
      () => new HttpError({ status: 400 }, { message: "x" }),
      () => new HttpError({ status: 404 }, { message: "x" }),
      () => new HttpError({ status: 429 }, { message: "x" }),
      () => new HttpError({ status: 500 }, { message: "x" }),
      () => new Error("boom"),
      () => new TypeError("x is not a function"),
    ]) {
      expect(isRetryableError(make())).toBe(false);
    }

    const { errors, wrapper } = await setup();
    const handler = vi.fn(async () => {
      throw new HttpError({ status: 500 }, { message: "defect" });
    });
    const { result } = renderHook(() => useQuery({ handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error?.message).toBe("defect"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  test("retry: 0 on the query, or in the atom, fails at once", async ({
    expect,
  }) => {
    {
      const { wrapper } = await setup();
      const handler = vi.fn(async () => {
        throw unavailable();
      });
      const { result } = renderHook(() => useQuery({ handler, retry: 0 }, []), {
        wrapper,
      });
      await waitFor(() => expect(result.current.error).toBeDefined());
      expect(handler).toHaveBeenCalledTimes(1);
    }
    {
      const { wrapper } = await setup((alepha) =>
        alepha.store.mut(queryOptionsAtom, (options) => ({
          ...options,
          retry: false as const,
        })),
      );
      const handler = vi.fn(async () => {
        throw unavailable();
      });
      const { result } = renderHook(() => useQuery({ handler }, []), {
        wrapper,
      });
      await waitFor(() => expect(result.current.error).toBeDefined());
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  test("the query's own retry wins over the atom, and a predicate decides each one", async ({
    expect,
  }) => {
    const { dateTime, wrapper } = await setup((alepha) =>
      alepha.store.mut(queryOptionsAtom, (options) => ({
        ...options,
        retry: 0,
      })),
    );
    const seen: number[] = [];
    const handler = vi.fn(async () => {
      throw new HttpError({ status: 429 }, { message: "slow down" });
    });
    const { result } = renderHook(
      () =>
        useQuery(
          {
            handler,
            retry: (error, attempt) => {
              seen.push(attempt);
              return attempt <= 1 && (error as HttpError).status === 429;
            },
          },
          [],
        ),
      { wrapper },
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(() => dateTime.travel(1250));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(handler).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([1, 2]);
  });

  test("an unmount stops the backoff: no attempt and no timer after it", async ({
    expect,
  }) => {
    const { dateTime, errors, wrapper } = await setup();
    const handler = vi.fn(async () => {
      throw unavailable();
    });
    const { unmount } = renderHook(() => useQuery({ handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    unmount();
    await act(() => dateTime.travel(60_000));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
    expect(
      (dateTime as unknown as { timeouts: unknown[] }).timeouts,
    ).toHaveLength(0);
  });

  test("refetch() during the backoff starts a fresh sequence", async ({
    expect,
  }) => {
    const { dateTime, wrapper } = await setup();
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw unavailable();
      }
      return calls;
    });
    const { result } = renderHook(() => useQuery({ handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toBe(2);
    await act(() => dateTime.travel(60_000));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("two components on one key share one sequence of attempts", async ({
    expect,
  }) => {
    const { dateTime, errors, wrapper } = await setup();
    const handler = vi.fn(async () => {
      throw unavailable();
    });
    const useTwo = () => ({
      a: useQuery({ key: ["shared"], handler }, []),
      b: useQuery({ key: ["shared"], handler }, []),
    });
    const { result } = renderHook(useTwo, { wrapper });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(() => dateTime.travel(1250));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await act(() => dateTime.travel(2500));
    await waitFor(() => expect(result.current.a.error).toBeDefined());
    await waitFor(() => expect(result.current.b.error).toBeDefined());
    expect(handler).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(2);
  });

  test("useAction has no retry: a failing handler runs once", async ({
    expect,
  }) => {
    const { dateTime, wrapper } = await setup();
    const handler = vi.fn(async () => {
      throw unavailable();
    });
    const { result } = renderHook(() => useAction({ handler }, []), {
      wrapper,
    });
    await act(async () => {
      await result.current.run();
    });
    await act(() => dateTime.travel(60_000));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe("down");
  });
});
