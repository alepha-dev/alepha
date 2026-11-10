import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { HttpError } from "alepha/server";
import { afterEach, describe, it, vi } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";
import { useQuery } from "../hooks/useQuery.ts";
import {
  AlephaReact,
  QueryCache,
  QueryWakeEvents,
  queryOptionsAtom,
} from "../index.ts";

let hidden = false;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => hidden,
});

const hide = () => {
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
};

const show = () => {
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
};

const online = () => window.dispatchEvent(new Event("online"));

class CountingWakeEvents extends QueryWakeEvents {
  public listens = 0;
  protected listen(handlers: Parameters<QueryWakeEvents["start"]>[0]) {
    this.listens += 1;
    return super.listen(handlers);
  }
}

const setup = async (configure?: (alepha: Alepha) => void) => {
  const alepha = Alepha.create()
    .with({ provide: QueryWakeEvents, use: CountingWakeEvents })
    .with(AlephaDateTime)
    .with(AlephaReact);
  configure?.(alepha);
  await alepha.start();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );
  return {
    alepha,
    wrapper,
    dateTime: alepha.inject(DateTimeProvider),
    wake: alepha.inject(CountingWakeEvents),
  };
};

afterEach(() => {
  hidden = false;
});

describe("useQuery refetch on reconnect and on tab return", () => {
  it("with no option set, a tab return sends nothing and a reconnect refetches", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(async () => handler.mock.calls.length);
    const { result } = renderHook(() => useQuery({ key: ["k"], handler }, []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => {
      hide();
      show();
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => online());
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("with refetchOnFocus, a tab return re-runs a stale query and keeps its data rendered", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    let release: (() => void) | undefined;
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      if (calls > 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return calls;
    });
    const { result } = renderHook(
      () => useQuery({ key: ["k"], handler, refetchOnFocus: true }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => show());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(true);

    await act(async () => release?.());
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("a fresh entry is left alone on a tab return and on a reconnect", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    renderHook(
      () =>
        useQuery(
          {
            key: ["k"],
            handler,
            staleTime: [1, "minute"],
            refetchOnFocus: true,
          },
          [],
        ),
      { wrapper },
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(async () => {
      show();
      online();
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("on reconnect, a fresh query whose last run failed re-runs", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await setup();
    let fail = false;
    const handler = vi.fn(async () => {
      if (fail) {
        throw new HttpError({ status: 503 }, { message: "offline" });
      }
      return handler.mock.calls.length;
    });
    const { result } = renderHook(
      () =>
        useQuery({ key: ["k"], handler, staleTime: [1, "hour"], retry: 0 }, []),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    // A refetch that fails keeps the entry, which is still fresh.
    fail = true;
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeDefined();
    expect(alepha.inject(QueryCache).isFresh(["k"], 3_600_000)).toBe(true);

    fail = false;
    await act(async () => online());
    await waitFor(() => expect(result.current.error).toBe(undefined));
    expect(result.current.data).toBe(3);
  });

  it("refetchOnReconnect: false, on the query or in the atom, turns it off; the query's own value wins", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await setup();
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    renderHook(
      () => ({
        a: useQuery({ key: ["a"], handler: a, refetchOnReconnect: false }, []),
        b: useQuery({ key: ["b"], handler: b }, []),
      }),
      { wrapper },
    );
    await waitFor(() => expect(b).toHaveBeenCalledTimes(1));
    await act(async () => online());
    await waitFor(() => expect(b).toHaveBeenCalledTimes(2));
    expect(a).toHaveBeenCalledTimes(1);

    alepha.store.mut(queryOptionsAtom, (options) => ({
      ...options,
      refetchOnReconnect: false,
      refetchOnFocus: true,
    }));
    await act(async () => online());
    expect(b).toHaveBeenCalledTimes(2);
    await act(async () => show());
    await waitFor(() => expect(b).toHaveBeenCalledTimes(3));
    expect(a).toHaveBeenCalledTimes(2);
  });

  it("two components on one key send one request on a refetch", async ({
    expect,
  }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    renderHook(
      () => ({
        a: useQuery({ key: ["shared"], handler }, []),
        b: useQuery({ key: ["shared"], handler }, []),
      }),
      { wrapper },
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(async () => online());
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("a keyless query is untouched", async ({ expect }) => {
    const { wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    renderHook(() => useQuery({ handler, refetchOnFocus: true }, []), {
      wrapper,
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await act(async () => {
      show();
      online();
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("listens once per container, whatever the number of hooks, and stops at stop", async ({
    expect,
  }) => {
    const { alepha, wake, wrapper } = await setup();
    const handler = vi.fn(async () => "v");
    const { unmount } = renderHook(
      () => ({
        a: useQuery({ key: ["a"], handler }, []),
        b: useQuery({ key: ["b"], handler }, []),
        c: useQuery({ key: ["c"], handler }, []),
      }),
      { wrapper },
    );
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
    expect(wake.listens).toBe(1);
    expect(alepha.inject(QueryCache).observerCount(["a"])).toBe(1);

    unmount();
    expect(alepha.inject(QueryCache).observerCount(["a"])).toBe(0);
    await alepha.stop();
    expect(wake.listening()).toBe(false);
  });

  it("a disabled query does not register", async ({ expect }) => {
    const { alepha, wrapper } = await setup();
    renderHook(
      () =>
        useQuery({ key: ["k"], handler: async () => 1, enabled: false }, []),
      { wrapper },
    );
    expect(alepha.inject(QueryCache).observerCount(["k"])).toBe(0);
  });
});

describe("polling while the document is hidden", () => {
  it("skips the ticks of useAction and useQuery while hidden, and resumes after", async ({
    expect,
  }) => {
    const { dateTime, wrapper } = await setup();
    dateTime.pause();
    const polled = vi.fn(async () => "a");
    const queried = vi.fn(async () => "q");
    renderHook(
      () => ({
        action: useAction({ handler: polled, runEvery: 1000 }, []),
        query: useQuery(
          { key: ["poll"], handler: queried, runEvery: 1000 },
          [],
        ),
      }),
      { wrapper },
    );
    await waitFor(() => expect(queried).toHaveBeenCalledTimes(1));

    await act(() => dateTime.travel(1000));
    await waitFor(() => expect(polled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queried).toHaveBeenCalledTimes(2));

    hidden = true;
    await act(() => dateTime.travel(1000));
    await act(() => dateTime.travel(1000));
    expect(polled).toHaveBeenCalledTimes(1);
    expect(queried).toHaveBeenCalledTimes(2);

    hidden = false;
    await act(() => dateTime.travel(1000));
    await waitFor(() => expect(polled).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queried).toHaveBeenCalledTimes(3));
  });
});
