import { Alepha } from "alepha";
import { describe, expect, it, vi } from "vitest";

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
    it("should create EventManager instance", () => {
      const eventManager = new EventManager();
      expect(eventManager).toBeInstanceOf(EventManager);
    });

    it("should create EventManager with logger function", () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logFn = () => mockLogger;
      const eventManager = new EventManager();
      eventManager.logFn = logFn;

      expect(eventManager).toBeInstanceOf(EventManager);
    });

    it("should be accessible via Alepha.events", () => {
      const alepha = Alepha.create();
      expect(alepha.events).toBeInstanceOf(EventManager);
    });
  });

  describe("on() - event registration", () => {
    it("should register event handler with callback function", () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echo", callback);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should register event handler with hook object", () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echo", {
        callback,
        caller: undefined,
      });

      expect(typeof unsubscribe).toBe("function");
    });

    it("should register multiple handlers for the same event", () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("test:echo", callback1);
      eventManager.on("test:echo", callback2);

      // Both handlers should be registered (verified by emit test)
    });

    it("should register handlers for different events", () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("test:echo", callback1);
      eventManager.on("configure", callback2);

      // Handlers should be registered separately (verified by emit test)
    });
  });

  describe("emit() - event execution", () => {
    it("should execute registered callback", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      eventManager.on("test:echo", callback);
      await eventManager.emit("test:echo", { test: "data" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ test: "data" });
    });

    it("should execute multiple callbacks in order", async () => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("test:echo", async () => {
        order.push(1);
      });
      eventManager.on("test:echo", async () => {
        order.push(2);
      });
      eventManager.on("test:echo", async () => {
        order.push(3);
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual([1, 2, 3]);
    });

    it("should execute callbacks sequentially (not in parallel)", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("1-end");
      });
      eventManager.on("test:echo", async () => {
        order.push("2-start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("2-end");
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["1-start", "1-end", "2-start", "2-end"]);
    });

    it("should pass payload to all callbacks", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const payload = { value: 42, name: "test" };

      eventManager.on("test:echo", callback1);
      eventManager.on("test:echo", callback2);

      await eventManager.emit("test:echo", payload);

      expect(callback1).toHaveBeenCalledWith(payload);
      expect(callback2).toHaveBeenCalledWith(payload);
    });

    it("should not execute callbacks for different events", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("test:echo", callback1);
      eventManager.on("configure", callback2);

      await eventManager.emit("test:echo", {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should handle events with no registered callbacks", async () => {
      const eventManager = new EventManager();

      // Should not throw
      await expect(eventManager.emit("test:echo", {})).resolves.toBeUndefined();
    });

    it("should work with Alepha lifecycle events", async () => {
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

  describe("hook priorities", () => {
    it("should execute 'first' priority hooks before others", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", async () => {
        order.push("normal");
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("first");
        },
        priority: "first",
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["first", "normal"]);
    });

    it("should execute 'last' priority hooks after others", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", async () => {
        order.push("normal");
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["normal", "last"]);
    });

    it("should handle multiple priority levels correctly", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", async () => {
        order.push("normal1");
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("first1");
        },
        priority: "first",
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("last1");
        },
        priority: "last",
      });
      eventManager.on("test:echo", async () => {
        order.push("normal2");
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("first2");
        },
        priority: "first",
      });
      eventManager.on("test:echo", {
        callback: async () => {
          order.push("last2");
        },
        priority: "last",
      });

      await eventManager.emit("test:echo", {});

      // First hooks preserve registration order, then normal, then last
      expect(order[0]).toBe("first1");
      expect(order[1]).toBe("first2");
      expect(order[order.length - 2]).toBe("last1");
      expect(order[order.length - 1]).toBe("last2");
    });

    it("should insert normal hooks before existing last hooks", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });
      eventManager.on("test:echo", async () => {
        order.push("normal");
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["normal", "last"]);
    });
  });

  describe("error handling", () => {
    it("should throw error when callback throws", async () => {
      const eventManager = new EventManager();

      eventManager.on("test:echo", async () => {
        throw new Error("Test error");
      });

      await expect(eventManager.emit("test:echo", {})).rejects.toThrow(
        "Test error",
      );
    });

    it("should stop execution on first error", async () => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("test:echo", async () => {
        throw new Error("Test error");
      });
      eventManager.on("test:echo", callback2);

      await expect(eventManager.emit("test:echo", {})).rejects.toThrow();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should catch errors when catch option is true", async () => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("test:echo", async () => {
        throw new Error("Test error");
      });
      eventManager.on("test:echo", callback2);

      await expect(
        eventManager.emit("test:echo", {}, { catch: true }),
      ).resolves.toBeUndefined();

      // Second callback should still execute
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should continue executing after caught error", async () => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("test:echo", async () => {
        order.push(1);
        throw new Error("Error in 1");
      });
      eventManager.on("test:echo", async () => {
        order.push(2);
      });
      eventManager.on("test:echo", async () => {
        order.push(3);
        throw new Error("Error in 3");
      });
      eventManager.on("test:echo", async () => {
        order.push(4);
      });

      await eventManager.emit("test:echo", {}, { catch: true });

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("reports which hook failed without changing what is thrown", async () => {
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

      eventManager.on("test:echo", {
        callback: async () => {
          throw new TestError("Test error");
        },
        caller: TestService,
      });

      // The handler's OWN error, not a wrapper. It used to be wrapped on this
      // path only, so an `instanceof` check on a hook failure answered
      // differently depending on whether logging was on.
      const error = await eventManager
        .emit("test:echo", {}, { log: true })
        .catch((e) => e);
      expect(error).toBeInstanceOf(TestError);
      expect(error.message).toBe("Test error");

      // The context the wrapper carried is still reported, as a log line.
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed during 'test:echo()' hook for service: TestService",
        error,
      );
    });

    it("throws the same error whether or not the emit logs", async () => {
      const eventManager = new EventManager();

      class TestService {}

      eventManager.on("test:echo", {
        callback: async () => {
          throw new TestError("Test error");
        },
        caller: TestService,
      });

      const logged = await eventManager
        .emit("test:echo", {}, { log: true })
        .catch((e) => e);
      const quiet = await eventManager.emit("test:echo", {}).catch((e) => e);

      expect(logged).toBeInstanceOf(TestError);
      expect(quiet).toBeInstanceOf(TestError);
      expect(logged.message).toBe(quiet.message);
    });

    it("should log errors when catch and log options are both true", async () => {
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

      eventManager.on("test:echo", {
        callback: async () => {
          throw new Error("Test error");
        },
        caller: TestService,
      });

      await eventManager.emit("test:echo", {}, { catch: true, log: true });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("logging", () => {
    it("should log trace and debug messages when log option is true", async () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echo", async () => {
        // Simple callback
      });

      await eventManager.emit("test:echo", {}, { log: true });

      expect(mockLogger.trace).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should log execution time for each hook", async () => {
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

      eventManager.on("test:echo", {
        callback: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
        caller: TestService,
      });

      await eventManager.emit("test:echo", {}, { log: true });

      // Should log the hook execution with timing
      const debugCalls = (mockLogger.debug as any).mock.calls;
      const hasTimingLog = debugCalls.some(
        (call: any[]) => call[0].includes("OK") && call[0].includes("ms"),
      );
      expect(hasTimingLog).toBe(true);
    });

    it("should log service name from caller", async () => {
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

      eventManager.on("test:echo", {
        callback: async () => {},
        caller: MyCustomService,
      });

      await eventManager.emit("test:echo", {}, { log: true });

      const traceCalls = (mockLogger.trace as any).mock.calls;
      const hasServiceName = traceCalls.some((call: any[]) =>
        call[0].includes("MyCustomService"),
      );
      expect(hasServiceName).toBe(true);
    });

    it("should log 'unknown' when caller is not provided", async () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echo", async () => {});

      await eventManager.emit("test:echo", {}, { log: true });

      const traceCalls = (mockLogger.trace as any).mock.calls;
      const hasUnknown = traceCalls.some((call: any[]) =>
        call[0].includes("unknown"),
      );
      expect(hasUnknown).toBe(true);
    });

    it("should not log when log option is false", async () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const eventManager = new EventManager();
      eventManager.logFn = () => mockLogger;

      eventManager.on("test:echo", async () => {});

      await eventManager.emit("test:echo", {});

      expect(mockLogger.trace).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    it("should return unsubscribe function from on()", () => {
      const eventManager = new EventManager();
      const unsubscribe = eventManager.on("test:echo", async () => {});

      expect(typeof unsubscribe).toBe("function");
    });

    it("should remove handler when unsubscribe is called", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echo", callback);
      unsubscribe();

      await eventManager.emit("test:echo", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should only remove specific handler", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = eventManager.on("test:echo", callback1);
      eventManager.on("test:echo", callback2);
      eventManager.on("test:echo", callback3);

      unsubscribe1();

      await eventManager.emit("test:echo", {});

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it("should only remove its own registration when one callback is registered twice", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe1 = eventManager.on("test:echo", callback);
      eventManager.on("test:echo", callback);

      unsubscribe1();

      await eventManager.emit("test:echo", {});

      // The second registration must survive: unsubscribing is per
      // registration (hook identity), not per callback function.
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should allow multiple unsubscribe calls safely", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("test:echo", callback);
      unsubscribe();
      unsubscribe(); // Should not throw

      await eventManager.emit("test:echo", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should work with different events", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = eventManager.on("test:echo", callback1);
      eventManager.on("configure", callback2);

      unsubscribe1();

      await eventManager.emit("test:echo", {});
      await eventManager.emit("configure", {} as any);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("integration with Alepha", () => {
    it("should share EventManager instance across Alepha", () => {
      const alepha = Alepha.create();
      const events1 = alepha.events;
      const events2 = alepha.events;

      expect(events1).toBe(events2);
    });

    it("should trigger configure, start, and ready hooks in order", async () => {
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

    it("should allow manual event emission", async () => {
      const alepha = Alepha.create();
      const callback = vi.fn();

      alepha.events.on("test:echo", callback);
      await alepha.events.emit("test:echo", { custom: "data" });

      expect(callback).toHaveBeenCalledWith({ custom: "data" });
    });

    it("should work with custom hook types via module augmentation", async () => {
      const alepha = Alepha.create();
      const callback = vi.fn();

      // Using the 'echo' hook which is defined in Hooks interface
      alepha.events.on("test:echo", callback);
      await alepha.events.emit("test:echo", { test: true });

      expect(callback).toHaveBeenCalledWith({ test: true });
    });
  });

  describe("async behavior", () => {
    it("should wait for async callbacks to complete", async () => {
      const eventManager = new EventManager();
      let completed = false;

      eventManager.on("test:echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completed = true;
      });

      await eventManager.emit("test:echo", {});

      expect(completed).toBe(true);
    });

    it("should execute async callbacks sequentially", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("test:echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("first");
      });
      eventManager.on("test:echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("second");
      });

      await eventManager.emit("test:echo", {});

      // Second callback should wait for first to complete
      expect(order).toEqual(["first", "second"]);
    });

    it("should handle Promise rejections as errors", async () => {
      const eventManager = new EventManager();

      eventManager.on("test:echo", async () => {
        return Promise.reject(new Error("Async error"));
      });

      await expect(eventManager.emit("test:echo", {})).rejects.toThrow(
        "Async error",
      );
    });
  });

  describe("before/after ordering", () => {
    it("should run hook with after constraint after the referenced service", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should run hook with after constraint after the referenced service (reverse registration)", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // Register B first, but it has after: [ServiceA]
      eventManager.on("test:echo", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should run hook with before constraint before the referenced service", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // Register B first, then A with before: [ServiceB]
      eventManager.on("test:echo", {
        caller: ServiceB,
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        before: [ServiceB],
        callback: async () => {
          order.push("A");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A", "B"]);
    });

    it("should handle combined before and after on same hook", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}
      class ServiceC {}

      eventManager.on("test:echo", {
        caller: ServiceC,
        callback: async () => {
          order.push("C");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      // B runs after A and before C
      eventManager.on("test:echo", {
        caller: ServiceB,
        after: [ServiceA],
        before: [ServiceC],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A", "B", "C"]);
    });

    it("should detect circular dependencies", async () => {
      const eventManager = new EventManager();

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echo", {
        caller: ServiceA,
        after: [ServiceB],
        callback: async () => {},
      });
      eventManager.on("test:echo", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {},
      });

      await expect(eventManager.emit("test:echo", {})).rejects.toThrow(
        "Circular dependency detected in hook before/after constraints",
      );
    });

    it("should preserve registration order for unconstrained hooks", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}
      class ServiceC {}

      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceB,
        callback: async () => {
          order.push("B");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceC,
        callback: async () => {
          order.push("C");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A", "B", "C"]);
    });

    it("should handle multiple hooks from the same service with constraints", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A1");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A2");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceB,
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["A1", "A2", "B"]);
    });

    it("should sort within priority tiers independently", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      eventManager.on("test:echo", {
        caller: ServiceB,
        priority: "first",
        callback: async () => {
          order.push("first-B");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        priority: "first",
        before: [ServiceB],
        callback: async () => {
          order.push("first-A");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("normal");
        },
      });

      await eventManager.emit("test:echo", {});

      expect(order).toEqual(["first-A", "first-B", "normal"]);
    });

    it("should ignore after constraints referencing services not in the same tier", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      class ServiceA {}
      class ServiceB {}

      // A is in normal tier, B is in last tier with after: [ServiceA]
      // The constraint targets a service not in the same tier, so it's ignored
      eventManager.on("test:echo", {
        caller: ServiceA,
        callback: async () => {
          order.push("A");
        },
      });
      eventManager.on("test:echo", {
        caller: ServiceB,
        priority: "last",
        after: [ServiceA],
        callback: async () => {
          order.push("B");
        },
      });

      await eventManager.emit("test:echo", {});

      // A runs first (normal tier), B runs after (last tier)
      expect(order).toEqual(["A", "B"]);
    });
  });
});

declare module "alepha" {
  interface Hooks {
    "test:echo": unknown;
  }
}
