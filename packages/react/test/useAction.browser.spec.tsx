import { Alepha } from "@alepha/core";
import { dom } from "@alepha/testing";
import { describe, test, vi } from "vitest";
import { AlephaContext } from "../src/contexts/AlephaContext.ts";
import { useAction } from "../src/hooks/useAction.ts";

describe("useAction", () => {
  test("should handle successful action", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => {
      return `result: ${value}`;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const [handler, initialState] = result.current;

    expect(initialState.loading).toBe(false);
    expect(initialState.error).toBe(null);
    expect(initialState.cancel).toBeDefined();

    const actionResult = await handler("test");

    expect(actionResult).toBe("result: test");
    expect(mockAction).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

    const [, finalState] = result.current;
    expect(finalState.loading).toBe(false);
    expect(finalState.error).toBe(null);
  });

  test("should emit react:action events", async ({ expect }) => {
    const alepha = Alepha.create();
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

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const [handler] = result.current;
    await handler();

    expect(events).toEqual(["begin", "success", "end"]);
  });

  test.skip("should handle errors", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const error = new Error("Test error");
    const mockAction = vi.fn(async (ctx) => {
      throw error;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const [handler] = result.current;

    await expect(() => handler()).rejects.toThrow("Test error");

    const [, currentState] = result.current;
    expect(currentState.error).toBe(error);
    expect(currentState.loading).toBe(false);
  });

  test("should emit react:action:error on failure", async ({ expect }) => {
    const alepha = Alepha.create();
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

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      {
        wrapper,
      },
    );

    const [handler] = result.current;

    try {
      await handler();
    } catch {
      // Expected
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error).toBe(error);
  });

  test("should call custom error handler", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const error = new Error("Test error");
    const mockAction = vi.fn(async (ctx) => {
      throw error;
    });
    const onError = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, onError }, []),
      { wrapper },
    );

    const [handler] = result.current;
    await handler();

    expect(onError).toHaveBeenCalledWith(error);
  });

  test("should call custom success handler", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => "result");
    const onSuccess = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, onSuccess }, []),
      { wrapper },
    );

    const [handler] = result.current;
    await handler();

    expect(onSuccess).toHaveBeenCalledWith("result");
  });

  test("should include action id in events", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const events: Array<{ id?: string }> = [];

    alepha.events.on("react:action:begin", (ev) => {
      events.push({ id: ev.id });
    });

    const mockAction = vi.fn(async (ctx) => "done");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, id: "test-action" }, []),
      { wrapper },
    );

    const [handler] = result.current;
    await handler();

    expect(events[0].id).toBe("test-action");
  });

  test("should prevent concurrent executions", async ({ expect }) => {
    const alepha = Alepha.create();
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

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const [handler] = result.current;

    // Call 100 times rapidly
    const promises = Array.from({ length: 100 }, () => handler());

    // Wait for all to complete
    await Promise.all(promises);

    // Should have only executed once
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(executionCount).toBe(1);
  });

  test("should debounce action calls", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, debounce: 50 }, []),
      { wrapper },
    );

    const [handler] = result.current;

    // Call 100 times rapidly with different values
    for (let i = 0; i < 100; i++) {
      handler(`value-${i}`);
    }

    // Wait for debounce to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have only executed once with the last value
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith("value-99", expect.any(Object));
  });

  test("should reset debounce timer on each call", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, debounce: 50 }, []),
      { wrapper },
    );

    const [handler] = result.current;

    // Call multiple times with delays
    handler("first");
    await new Promise((resolve) => setTimeout(resolve, 30));
    handler("second");
    await new Promise((resolve) => setTimeout(resolve, 30));
    handler("third");

    // Wait for final debounce
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Should have only executed once with the last value
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith("third", expect.any(Object));
  });

  test("should pass AbortSignal to handler", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    let receivedSignal: AbortSignal | undefined;

    const mockAction = vi.fn(async (value: string, { signal }) => {
      receivedSignal = signal as AbortSignal;
      return value;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const [handler] = result.current;
    await handler("test");

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  test("should cancel in-flight request with cancel()", async ({ expect }) => {
    const alepha = Alepha.create();
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

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const [handler, { cancel }] = result.current;

    // Start action
    const promise = handler();

    // Cancel after 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancel();

    await promise;

    expect(wasAborted).toBe(true);
  });

  test("should cancel debounced action", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (value: string, ctx) => value);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction, debounce: 100 }, []),
      { wrapper },
    );

    const [handler, { cancel }] = result.current;

    // Call handler
    handler("test");

    // Cancel before debounce completes
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancel();

    // Wait for debounce period
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not have executed
    expect(mockAction).not.toHaveBeenCalled();
  });

  test("should handle AbortError gracefully", async ({ expect }) => {
    const alepha = Alepha.create();
    await alepha.start();

    const mockAction = vi.fn(async (ctx) => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = dom.renderHook(
      () => useAction({ handler: mockAction }, []),
      { wrapper },
    );

    const [handler, state] = result.current;
    await handler();

    // Should not set error state for abort errors
    const [, finalState] = result.current;
    expect(finalState.error).toBe(null);
  });
});
