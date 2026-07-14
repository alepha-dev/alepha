import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { describe, test, vi } from "vitest";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useQuery } from "../hooks/useQuery.ts";

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
