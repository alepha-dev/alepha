import { renderHook } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import type { ReactNode } from "react";
import { describe, test, vi } from "vitest";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";

describe("useAction", () => {
  test("should handle successful action", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => {
      return `result: ${value}`;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const action = result.current;

    expect(action.loading).toBe(false);
    expect(action.error).toBe(undefined);
    expect(action.cancel).toBeDefined();
    expect(action.run).toBeDefined();

    const actionResult = await action.run("test");

    expect(actionResult).toBe("result: test");
    expect(mockAction).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(undefined);
  });

  test("should emit react:action events", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const events: string[] = [];

    alepha.events.on("react:action:begin", () => {
      events.push("begin");
    });
    alepha.events.on("react:action:success", () => {
      events.push("success");
    });
    alepha.events.on("react:action:end", () => {
      events.push("end");
    });

    const mockAction = vi.fn(async (ctx) => "done");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const action = result.current;
    await action.run();

    expect(events).toEqual(["begin", "success", "end"]);
  });

  test.skip("should handle errors", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const error = new Error("Test error");
    const mockAction = vi.fn(async (ctx) => {
      throw error;
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const action = result.current;

    await expect(() => action.run()).rejects.toThrow("Test error");

    expect(result.current.error).toBe(error);
    expect(result.current.loading).toBe(false);
  });

  test("should emit react:action:error on failure", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const events: Array<{ type: string; error?: Error }> = [];

    alepha.events.on("react:action:error", (ev) => {
      events.push({ type: "error", error: ev.error });
    });

    const error = new Error("Test error");
    const mockAction = vi.fn(async (ctx) => {
      throw error;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const action = result.current;

    try {
      await action.run();
    } catch {
      // Expected
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error).toBe(error);
  });

  test("should call custom error handler", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const error = new Error("Test error");
    const mockAction = vi.fn(async (ctx) => {
      throw error;
    });
    const onError = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, onError }, []),
      { wrapper },
    );

    const action = result.current;
    await action.run();

    expect(onError).toHaveBeenCalledWith(error);
  });

  test("should call custom success handler", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "result");
    const onSuccess = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, onSuccess }, []),
      { wrapper },
    );

    const action = result.current;
    await action.run();

    expect(onSuccess).toHaveBeenCalledWith("result");
  });

  test("should include action id in events", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const events: Array<{ id?: string }> = [];

    alepha.events.on("react:action:begin", (ev) => {
      events.push({ id: ev.id });
    });

    const mockAction = vi.fn(async (ctx) => "done");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, id: "test-action" }, []),
      { wrapper },
    );

    const action = result.current;
    await action.run();

    expect(events[0].id).toBe("test-action");
  });

  test("should prevent concurrent executions", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    let executionCount = 0;
    const mockAction = vi.fn(async (ctx) => {
      executionCount++;
      // Simulate slow operation
      await new Promise((resolve) => setTimeout(resolve, 100));
      return executionCount;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const action = result.current;

    // Call 100 times rapidly
    const promises = Array.from({ length: 100 }, () => action.run());

    // Wait for all to complete
    await Promise.all(promises);

    // Should have only executed once
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(executionCount).toBe(1);
  });

  test("should debounce action calls", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, debounce: 50 }, []),
      { wrapper },
    );

    const action = result.current;

    // Call 100 times rapidly with different values
    for (let i = 0; i < 100; i++) {
      action.run(`value-${i}`);
    }

    // Wait for debounce to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have only executed once with the last value
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith("value-99", expect.any(Object));
  });

  test("should reset debounce timer on each call", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, debounce: 50 }, []),
      { wrapper },
    );

    const action = result.current;

    // Call multiple times with delays
    action.run("first");
    await new Promise((resolve) => setTimeout(resolve, 30));
    action.run("second");
    await new Promise((resolve) => setTimeout(resolve, 30));
    action.run("third");

    // Wait for final debounce
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Should have only executed once with the last value
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith("third", expect.any(Object));
  });

  test("should pass AbortSignal to handler", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    let receivedSignal: AbortSignal | undefined;

    const mockAction = vi.fn(async (value: string, { signal }) => {
      receivedSignal = signal as AbortSignal;
      return value;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const action = result.current;
    await action.run("test");

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  test("should cancel in-flight request with cancel()", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    let wasAborted = false;
    const mockAction = vi.fn(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      wasAborted = ctx.signal.aborted;
      return "done";
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const action = result.current;

    // Start action
    const promise = action.run();

    // Cancel after 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));
    action.cancel();

    await promise;

    expect(wasAborted).toBe(true);
  });

  test("should cancel debounced action", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction, debounce: 100 }, []),
      { wrapper },
    );

    const action = result.current;

    // Call handler
    action.run("test");

    // Cancel before debounce completes
    await new Promise((resolve) => setTimeout(resolve, 50));
    action.cancel();

    // Wait for debounce period
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not have executed
    expect(mockAction).not.toHaveBeenCalled();
  });

  test("should handle AbortError gracefully", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const action = result.current;
    await action.run();

    // Should not set error state for abort errors
    expect(result.current.error).toBe(undefined);
  });

  test("should run action on mount with runOnInit", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "initialized");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    renderHook(() => useAction({ handler: mockAction, runOnInit: true }, []), {
      wrapper,
    });

    // Wait a tick for the effect to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should have been called once on mount
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  test("should not run action on mount without runOnInit", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "result");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    renderHook(() => useAction({ handler: mockAction }, []), {
      wrapper,
    });

    // Wait a tick
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should not have been called
    expect(mockAction).not.toHaveBeenCalled();
  });

  test("should run action periodically with runEvery (milliseconds)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "fired");

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { unmount } = renderHook(
      () => useAction({ handler: mockAction, runEvery: 60 }, []),
      { wrapper },
    );

    // Wait for multiple intervals
    await new Promise((resolve) => setTimeout(resolve, 160));

    // Should have been called approximately 3 times (at 50ms, 100ms, 150ms)
    expect(mockAction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockAction.mock.calls.length).toBeLessThanOrEqual(4);

    // Cleanup
    unmount();
  });

  test("should run action periodically with runEvery (duration tuple)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "polled");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { unmount } = renderHook(
      () =>
        useAction({ handler: mockAction, runEvery: [50, "milliseconds"] }, []),
      { wrapper },
    );

    // Wait for multiple intervals
    await new Promise((resolve) => setTimeout(resolve, 160));

    // Should have been called approximately 3 times
    expect(mockAction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockAction.mock.calls.length).toBeLessThanOrEqual(4);

    // Cleanup
    unmount();
  });

  test("should keep polling when the component re-renders faster than runEvery", async ({
    expect,
  }) => {
    // The interval effect keyed on `runAction`, whose identity changed on
    // every render because of the inline `onSuccess` (exactly what `useQuery`
    // passes). Each render tore the interval down and started a new one, so a
    // component re-rendering faster than the period never polled at all.
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async () => "polled");

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { rerender, unmount } = renderHook(
      () =>
        useAction(
          {
            handler: mockAction,
            runEvery: 60,
            onSuccess: () => {},
          },
          [],
        ),
      { wrapper },
    );

    for (let i = 0; i < 20; i++) {
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    expect(mockAction.mock.calls.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  test("should keep polling when runEvery is an inline duration tuple", async ({
    expect,
  }) => {
    // `[50, "milliseconds"]` is a fresh array on every render — the documented
    // form of the option, and enough on its own to reset the interval.
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async () => "polled");

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { rerender, unmount } = renderHook(
      () =>
        useAction({ handler: mockAction, runEvery: [50, "milliseconds"] }, []),
      { wrapper },
    );

    for (let i = 0; i < 20; i++) {
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    expect(mockAction.mock.calls.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  test("should cleanup interval on unmount", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "polled");

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { unmount } = renderHook(
      () => useAction({ handler: mockAction, runEvery: 50 }, []),
      { wrapper },
    );

    // Wait for one interval
    await new Promise((resolve) => setTimeout(resolve, 75));
    const callsBeforeUnmount = mockAction.mock.calls.length;

    // Unmount
    unmount();

    // Wait for what would be another interval
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not have been called again after unmount
    expect(mockAction.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
