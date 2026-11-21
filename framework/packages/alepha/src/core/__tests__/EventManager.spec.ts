import { Alepha } from "alepha";
import { describe, it, vi } from "vitest";

import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";
import { EventManager } from "../providers/EventManager.ts";

/**
 * A distinct class, so "the handler's own error reached the caller" can be
 * asserted by identity rather than by message.
 */
class TestError extends Error {
  override name = "TestError";
}

describe("EventManager", () => {
  describe("initialization", () => {
    it("should be accessible via Alepha.events", ({ expect }) => {
      const alepha = Alepha.create();
      expect(alepha.events).toBeInstanceOf(EventManager);
    });
  });

  describe("emit() - event execution", () => {
    it("should execute registered callback", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      eventManager.on("test:echoed", callback);
      await eventManager.emit("test:echoed", { test: "data" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ test: "data" });
    });

    it("should execute multiple callbacks in order", async ({ expect }) => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("test:echoed", async () => {
        order.push(1);
      });
      eventManager.on("test:echoed", async () => {
        order.push(2);
      });
      eventManager.on("test:echoed", async () => {
        order.push(3);
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual([1, 2, 3]);
    });

    it("should execute callbacks sequentially (not in parallel)", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echoed", async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("1-end");
      });
      eventManager.on("test:echoed", async () => {
        order.push("2-start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("2-end");
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["1-start", "1-end", "2-start", "2-end"]);
    });

    it("should pass payload to all callbacks", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const payload = { value: 42, name: "test" };

      eventManager.on("test:echoed", callback1);
      eventManager.on("test:echoed", callback2);

      await eventManager.emit("test:echoed", payload);

      expect(callback1).toHaveBeenCalledWith(payload);
      expect(callback2).toHaveBeenCalledWith(payload);
    });

    it("should not execute callbacks for different events", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("test:echoed", callback1);
      eventManager.on("configure", callback2);

      await eventManager.emit("test:echoed", {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should handle events with no registered callbacks", async ({
      expect,
    }) => {
      const eventManager = new EventManager();

      // Should not throw
      await expect(
        eventManager.emit("test:echoed", {}),
      ).resolves.toBeUndefined();
    });

    it("should work with Alepha lifecycle events", async ({ expect }) => {
      const alepha = Alepha.create();
      const configureCallback = vi.fn();
      const startCallback = vi.fn();
      const readyCallback = vi.fn();

      alepha.events.on("configure", configureCallback);
      alepha.events.on("start", startCallback);
      alepha.events.on("ready", readyCallback);

      await alepha.start();

      expect(configureCallback).toHaveBeenCalledTimes(1);
      expect(startCallback).toHaveBeenCalledTimes(1);
      expect(readyCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispatch() - emit without the async frame", () => {
    it("returns nothing when every hook is synchronous, and has run them all", ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: number[] = [];
      eventManager.on("test:echoed", () => {
        order.push(1);
      });
      eventManager.on("test:echoed", () => {
        order.push(2);
      });

      const done = eventManager.dispatch("test:echoed", {});

      expect(done).toBeUndefined();
      expect(order).toEqual([1, 2]);
    });

    it("returns a promise once a hook is async, and keeps the hooks in order", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: number[] = [];
      eventManager.on("test:echoed", () => {
        order.push(1);
      });
      eventManager.on("test:echoed", async () => {
        await Promise.resolve();
        order.push(2);
      });
      eventManager.on("test:echoed", () => {
        order.push(3);
      });

      const done = eventManager.dispatch("test:echoed", {});

      expect(done).toBeInstanceOf(Promise);
      expect(order).toEqual([1]);
      await done;
      expect(order).toEqual([1, 2, 3]);
    });

    it("throws a synchronous hook's error as it was thrown", ({ expect }) => {
      const eventManager = new EventManager();
      const error = new TestError("boom");
      eventManager.on("test:echoed", () => {
        throw error;
      });

      expect(() => eventManager.dispatch("test:echoed", {})).toThrow(error);
    });

    it("reports instead of throwing with catchErrors, and runs the next hooks", ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: number[] = [];
      eventManager.on("test:echoed", () => {
        throw new TestError("boom");
      });
      eventManager.on("test:echoed", () => {
        order.push(2);
      });

      // The report goes to the logger; with none attached it is dropped.
      const done = eventManager.dispatch("test:echoed", {}, true);

      expect(done).toBeUndefined();
      expect(order).toEqual([2]);
    });
  });

  describe("hook priorities", () => {
    it("should execute 'first' priority hooks before others", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echoed", async () => {
        order.push("normal");
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("first");
        },
        priority: "first",
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["first", "normal"]);
    });

    it("should execute 'last' priority hooks after others", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echoed", async () => {
        order.push("normal");
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["normal", "last"]);
    });

    it("should handle multiple priority levels correctly", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echoed", async () => {
        order.push("normal1");
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("first1");
        },
        priority: "first",
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("last1");
        },
        priority: "last",
      });
      eventManager.on("test:echoed", async () => {
        order.push("normal2");
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("first2");
        },
        priority: "first",
      });
      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("last2");
        },
        priority: "last",
      });

      await eventManager.emit("test:echoed", {});

      // First hooks preserve registration order, then normal, then last
      expect(order[0]).toBe("first1");
      expect(order[1]).toBe("first2");
      expect(order[order.length - 2]).toBe("last1");
      expect(order[order.length - 1]).toBe("last2");
    });

    it("should insert normal hooks before existing last hooks", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echoed", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });
      eventManager.on("test:echoed", async () => {
        order.push("normal");
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["normal", "last"]);
    });
  });

  describe("error handling", () => {
    it("should throw error when callback throws", async ({ expect }) => {
      const eventManager = new EventManager();

      eventManager.on("test:echoed", async () => {
        throw new Error("Test error");
      });

      await expect(eventManager.emit("test:echoed", {})).rejects.toThrow(
        "Test error",
      );
    });

    it("should stop execution on first error", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("test:echoed", async () => {
        throw new Error("Test error");
      });
      eventManager.on("test:echoed", callback2);

      await expect(eventManager.emit("test:echoed", {})).rejects.toThrow();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should catch errors when catch option is true", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("test:echoed", async () => {
        throw new Error("Test error");
      });
      eventManager.on("test:echoed", callback2);

      await expect(
        eventManager.emit("test:echoed", {}, { catch: true }),
      ).resolves.toBeUndefined();

      // Second callback should still execute
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should keep an event named `<event>:catch` apart from the caught run of `<event>`", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const calls: string[] = [];
      const suffixed = "test:echoed:catch" as "test:echoed";

      eventManager.on("test:echoed", () => {
        calls.push("echoed");
        throw new TestError("from echoed");
      });
      const off = eventManager.on(suffixed, () => {
        calls.push("suffixed");
        throw new TestError("from suffixed");
      });

      await eventManager.emit("test:echoed", {}, { catch: true });
      expect(calls).toEqual(["echoed"]);

      // Its own listener runs, and its error is not swallowed.
      await expect(eventManager.emit(suffixed, {})).rejects.toThrow(
        "from suffixed",
      );
      expect(calls).toEqual(["echoed", "suffixed"]);

      // Unsubscribing it leaves the caught executor of `test:echoed` alone.
      off();
      await eventManager.emit(suffixed, {});
      await eventManager.emit("test:echoed", {}, { catch: true });
      expect(calls).toEqual(["echoed", "suffixed", "echoed"]);
    });

    it("should continue executing after caught error", async ({ expect }) => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("test:echoed", async () => {
        order.push(1);
        throw new Error("Error in 1");
      });
      eventManager.on("test:echoed", async () => {
        order.push(2);
      });
      eventManager.on("test:echoed", async () => {
        order.push(3);
        throw new Error("Error in 3");
      });
      eventManager.on("test:echoed", async () => {
        order.push(4);
      });

      await eventManager.emit("test:echoed", {}, { catch: true });

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("reports which hook failed without changing what is thrown", async ({
      expect,
    }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      class TestService {}

      eventManager.on("test:echoed", {
        callback: async () => {
          throw new TestError("Test error");
        },
        caller: TestService,
      });

      // The handler's OWN error, not a wrapper. It used to be wrapped on this
      // path only, so an `instanceof` check on a hook failure answered
      // differently depending on whether logging was on.
      const error = await eventManager
        .emit("test:echoed", {}, { log: true })
        .catch((e) => e);
      expect(error).toBeInstanceOf(TestError);
      expect(error.message).toBe("Test error");

      // The context the wrapper carried is still reported, as a log line.
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed during 'test:echoed()' hook for service: TestService",
        error,
      );
    });

    it("throws the same error whether or not the emit logs", async ({
      expect,
    }) => {
      const eventManager = new EventManager();

      class TestService {}

      eventManager.on("test:echoed", {
        callback: async () => {
          throw new TestError("Test error");
        },
        caller: TestService,
      });

      const logged = await eventManager
        .emit("test:echoed", {}, { log: true })
        .catch((e) => e);
      const quiet = await eventManager.emit("test:echoed", {}).catch((e) => e);

      expect(logged).toBeInstanceOf(TestError);
      expect(quiet).toBeInstanceOf(TestError);
      expect(logged.message).toBe(quiet.message);
    });

    it("should log errors when catch and log options are both true", async ({
      expect,
    }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      class TestService {}

      eventManager.on("test:echoed", {
        callback: async () => {
          throw new Error("Test error");
        },
        caller: TestService,
      });

      await eventManager.emit("test:echoed", {}, { catch: true, log: true });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("logging", () => {
    it("should log trace and debug messages when log option is true", async ({
      expect,
    }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echoed", async () => {
        // Simple callback
      });

      await eventManager.emit("test:echoed", {}, { log: true });

      expect(mockLogger.trace).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should log execution time for each hook", async ({ expect }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      class TestService {}

      eventManager.on("test:echoed", {
        callback: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
        caller: TestService,
      });

      await eventManager.emit("test:echoed", {}, { log: true });

      // Should log the hook execution with timing
      const debugCalls = (mockLogger.debug as any).mock.calls;
      const hasTimingLog = debugCalls.some(
        (call: any[]) => call[0].includes("OK") && call[0].includes("ms"),
      );
      expect(hasTimingLog).toBe(true);
    });

    it("should log service name from caller", async ({ expect }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      class MyCustomService {}

      eventManager.on("test:echoed", {
        callback: async () => {},
        caller: MyCustomService,
      });

      await eventManager.emit("test:echoed", {}, { log: true });

      const traceCalls = (mockLogger.trace as any).mock.calls;
      const hasServiceName = traceCalls.some((call: any[]) =>
        call[0].includes("MyCustomService"),
      );
      expect(hasServiceName).toBe(true);
    });

    it("should log 'unknown' when caller is not provided", async ({
      expect,
    }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echoed", async () => {});

      await eventManager.emit("test:echoed", {}, { log: true });

      const traceCalls = (mockLogger.trace as any).mock.calls;
      const hasUnknown = traceCalls.some((call: any[]) =>
        call[0].includes("unknown"),
      );
      expect(hasUnknown).toBe(true);
    });

    it("should not log when log option is false", async ({ expect }) => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echoed", async () => {});

      await eventManager.emit("test:echoed", {});

      expect(mockLogger.trace).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    it("should remove handler when unsubscribe is called", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echoed", callback);
      unsubscribe();

      await eventManager.emit("test:echoed", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should only remove specific handler", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = eventManager.on("test:echoed", callback1);
      eventManager.on("test:echoed", callback2);
      eventManager.on("test:echoed", callback3);

      unsubscribe1();

      await eventManager.emit("test:echoed", {});

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it("should only remove its own registration when one callback is registered twice", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe1 = eventManager.on("test:echoed", callback);
      eventManager.on("test:echoed", callback);

      unsubscribe1();

      await eventManager.emit("test:echoed", {});

      // The second registration must survive: unsubscribing is per
      // registration (hook identity), not per callback function.
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should allow multiple unsubscribe calls safely", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echoed", callback);
      unsubscribe();
      unsubscribe(); // Should not throw

      await eventManager.emit("test:echoed", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should work with different events", async ({ expect }) => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = eventManager.on("test:echoed", callback1);
      eventManager.on("configure", callback2);

      unsubscribe1();

      await eventManager.emit("test:echoed", {});
      await eventManager.emit("configure", {} as any);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("integration with Alepha", () => {
    it("should trigger configure, start, and ready hooks in order", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const order: string[] = [];

      alepha.events.on("configure", async () => {
        order.push("configure");
      });
      alepha.events.on("start", async () => {
        order.push("start");
      });
      alepha.events.on("ready", async () => {
        order.push("ready");
      });

      await alepha.start();

      expect(order).toEqual(["configure", "start", "ready"]);
    });

    it("should allow manual event emission", async ({ expect }) => {
      const alepha = Alepha.create();
      const callback = vi.fn();

      alepha.events.on("test:echoed", callback);
      await alepha.events.emit("test:echoed", { custom: "data" });

      expect(callback).toHaveBeenCalledWith({ custom: "data" });
    });
  });

  describe("async behavior", () => {
    it("should wait for async callbacks to complete", async ({ expect }) => {
      const eventManager = new EventManager();
      let completed = false;

      eventManager.on("test:echoed", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completed = true;
      });

      await eventManager.emit("test:echoed", {});

      expect(completed).toBe(true);
    });

    it("should handle Promise rejections as errors", async ({ expect }) => {
      const eventManager = new EventManager();

      eventManager.on("test:echoed", async () => {
        return Promise.reject(new Error("Async error"));
      });

      await expect(eventManager.emit("test:echoed", {})).rejects.toThrow(
        "Async error",
      );
    });
  });

  describe("before/after ordering", () => {
    it("should run hook with after constraint after the referenced service", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should run hook with after constraint after the referenced service (reverse registration)", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // Register B first, but it has after: [ServiceA]
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should run hook with before constraint before the referenced service", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // Register B first, then A with before: [ServiceB]
      eventManager.on("test:echoed", {
        caller: ServiceB,
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        before: [ServiceB],
        callback: async () => {
          order.push("A");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should handle combined before and after on same hook", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}
      class ServiceC {}

      eventManager.on("test:echoed", {
        caller: ServiceC,
        callback: async () => {
          order.push("C");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      // B runs after A and before C
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        before: [ServiceC],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A", "B", "C"]);
    });

    it("should detect circular dependencies", async ({ expect }) => {
      const eventManager = new EventManager();

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echoed", {
        caller: ServiceA,
        after: [ServiceB],
        callback: async () => {},
      });
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {},
      });

      await expect(eventManager.emit("test:echoed", {})).rejects.toThrow(
        "Circular dependency detected in hook before/after constraints",
      );
    });

    it("should preserve registration order for unconstrained hooks", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}
      class ServiceC {}

      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceB,
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceC,
        callback: async () => {
          order.push("C");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A", "B", "C"]);
    });

    it("should handle multiple hooks from the same service with constraints", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A1");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("A2");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["A1", "A2", "B"]);
    });

    it("should sort within priority tiers independently", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echoed", {
        caller: ServiceB,
        priority: "first",
        callback: async () => {
          order.push("first-B");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        priority: "first",
        before: [ServiceB],
        callback: async () => {
          order.push("first-A");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceA,
        callback: async () => {
          order.push("normal");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["first-A", "first-B", "normal"]);
    });

    it("should ignore after constraints referencing services not in the same tier", async ({
      expect,
    }) => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // A is in the last tier, B in the normal tier with after: [ServiceA].
      // Honoring the constraint would run A first; the tiers decide, so the
      // constraint is ignored and B runs first.
      eventManager.on("test:echoed", {
        caller: ServiceA,
        priority: "last",
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echoed", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echoed", {});

      expect(order).toEqual(["B", "A"]);
    });
  });
});

declare module "alepha" {
  interface Hooks {
    "test:echoed": unknown;
  }
}
