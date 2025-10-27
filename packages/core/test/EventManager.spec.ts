import { describe, expect, it, vi } from "vitest";
import { Alepha } from "../src";
import { EventManager } from "../src/providers/EventManager.ts";
import type { LoggerInterface } from "../src/interfaces/LoggerInterface.ts";

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
        fatal: vi.fn(),
      };

      const logFn = () => mockLogger;
      const eventManager = new EventManager(logFn);

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

      const unsubscribe = eventManager.on("echo", callback);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should register event handler with hook object", () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("echo", {
        callback,
        caller: undefined,
      });

      expect(typeof unsubscribe).toBe("function");
    });

    it("should register multiple handlers for the same event", () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("echo", callback1);
      eventManager.on("echo", callback2);

      // Both handlers should be registered (verified by emit test)
    });

    it("should register handlers for different events", () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("echo", callback1);
      eventManager.on("configure", callback2);

      // Handlers should be registered separately (verified by emit test)
    });
  });

  describe("emit() - event execution", () => {
    it("should execute registered callback", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      eventManager.on("echo", callback);
      await eventManager.emit("echo", { test: "data" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ test: "data" });
    });

    it("should execute multiple callbacks in order", async () => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("echo", async () => {
        order.push(1);
      });
      eventManager.on("echo", async () => {
        order.push(2);
      });
      eventManager.on("echo", async () => {
        order.push(3);
      });

      await eventManager.emit("echo", {});

      expect(order).toEqual([1, 2, 3]);
    });

    it("should execute callbacks sequentially (not in parallel)", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("1-end");
      });
      eventManager.on("echo", async () => {
        order.push("2-start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("2-end");
      });

      await eventManager.emit("echo", {});

      expect(order).toEqual(["1-start", "1-end", "2-start", "2-end"]);
    });

    it("should pass payload to all callbacks", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const payload = { value: 42, name: "test" };

      eventManager.on("echo", callback1);
      eventManager.on("echo", callback2);

      await eventManager.emit("echo", payload);

      expect(callback1).toHaveBeenCalledWith(payload);
      expect(callback2).toHaveBeenCalledWith(payload);
    });

    it("should not execute callbacks for different events", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventManager.on("echo", callback1);
      eventManager.on("configure", callback2);

      await eventManager.emit("echo", {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should handle events with no registered callbacks", async () => {
      const eventManager = new EventManager();

      // Should not throw
      await expect(eventManager.emit("echo", {})).resolves.toBeUndefined();
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

      eventManager.on("echo", async () => {
        order.push("normal");
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("first");
        },
        priority: "first",
      });

      await eventManager.emit("echo", {});

      expect(order).toEqual(["first", "normal"]);
    });

    it("should execute 'last' priority hooks after others", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", async () => {
        order.push("normal");
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });

      await eventManager.emit("echo", {});

      expect(order).toEqual(["normal", "last"]);
    });

    it("should handle multiple priority levels correctly", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", async () => {
        order.push("normal1");
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("first1");
        },
        priority: "first",
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("last1");
        },
        priority: "last",
      });
      eventManager.on("echo", async () => {
        order.push("normal2");
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("first2");
        },
        priority: "first",
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("last2");
        },
        priority: "last",
      });

      await eventManager.emit("echo", {});

      // First hooks are prepended (reverse order of registration)
      // Then normal hooks, then last hooks (in order of registration)
      expect(order[0]).toBe("first2");
      expect(order[1]).toBe("first1");
      expect(order[order.length - 2]).toBe("last1");
      expect(order[order.length - 1]).toBe("last2");
    });

    it("should insert normal hooks before existing last hooks", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });
      eventManager.on("echo", async () => {
        order.push("normal");
      });

      await eventManager.emit("echo", {});

      expect(order).toEqual(["normal", "last"]);
    });
  });

  describe("reverse execution order", () => {
    it("should execute hooks in reverse order when reverse option is true", async () => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("echo", async () => {
        order.push(1);
      });
      eventManager.on("echo", async () => {
        order.push(2);
      });
      eventManager.on("echo", async () => {
        order.push(3);
      });

      await eventManager.emit("echo", {}, { reverse: true });

      expect(order).toEqual([3, 2, 1]);
    });

    it("should reverse priorities correctly", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", {
        callback: async () => {
          order.push("first");
        },
        priority: "first",
      });
      eventManager.on("echo", async () => {
        order.push("normal");
      });
      eventManager.on("echo", {
        callback: async () => {
          order.push("last");
        },
        priority: "last",
      });

      await eventManager.emit("echo", {}, { reverse: true });

      // Reversed: last -> normal -> first
      expect(order).toEqual(["last", "normal", "first"]);
    });

    it("should work with stop lifecycle event", async () => {
      const alepha = Alepha.create();
      const order: string[] = [];

      alepha.events.on("start", async () => {
        order.push("start-1");
      });
      alepha.events.on("start", async () => {
        order.push("start-2");
      });
      alepha.events.on("stop", async () => {
        order.push("stop-1");
      });
      alepha.events.on("stop", async () => {
        order.push("stop-2");
      });

      await alepha.start();
      await alepha.stop();

      // Start should be in order, stop should be reversed
      expect(order).toEqual(["start-1", "start-2", "stop-2", "stop-1"]);
    });
  });

  describe("error handling", () => {
    it("should throw error when callback throws", async () => {
      const eventManager = new EventManager();

      eventManager.on("echo", async () => {
        throw new Error("Test error");
      });

      await expect(eventManager.emit("echo", {})).rejects.toThrow("Test error");
    });

    it("should stop execution on first error", async () => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("echo", async () => {
        throw new Error("Test error");
      });
      eventManager.on("echo", callback2);

      await expect(eventManager.emit("echo", {})).rejects.toThrow();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should catch errors when catch option is true", async () => {
      const eventManager = new EventManager();
      const callback2 = vi.fn();

      eventManager.on("echo", async () => {
        throw new Error("Test error");
      });
      eventManager.on("echo", callback2);

      await expect(
        eventManager.emit("echo", {}, { catch: true }),
      ).resolves.toBeUndefined();

      // Second callback should still execute
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should continue executing after caught error", async () => {
      const eventManager = new EventManager();
      const order: number[] = [];

      eventManager.on("echo", async () => {
        order.push(1);
        throw new Error("Error in 1");
      });
      eventManager.on("echo", async () => {
        order.push(2);
      });
      eventManager.on("echo", async () => {
        order.push(3);
        throw new Error("Error in 3");
      });
      eventManager.on("echo", async () => {
        order.push(4);
      });

      await eventManager.emit("echo", {}, { catch: true });

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("should provide better error message with log option", async () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      class TestService {}

      eventManager.on("echo", {
        callback: async () => {
          throw new Error("Test error");
        },
        caller: TestService,
      });

      await expect(
        eventManager.emit("echo", {}, { log: true }),
      ).rejects.toThrow("Failed during 'echo()' hook for service: TestService");
    });

    it("should log errors when catch and log options are both true", async () => {
      const mockLogger: LoggerInterface = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      class TestService {}

      eventManager.on("echo", {
        callback: async () => {
          throw new Error("Test error");
        },
        caller: TestService,
      });

      await eventManager.emit("echo", {}, { catch: true, log: true });

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
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      eventManager.on("echo", async () => {
        // Simple callback
      });

      await eventManager.emit("echo", {}, { log: true });

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
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      class TestService {}

      eventManager.on("echo", {
        callback: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
        caller: TestService,
      });

      await eventManager.emit("echo", {}, { log: true });

      // Should log the hook execution with timing
      const debugCalls = (mockLogger.debug as any).mock.calls;
      const hasTimingLog = debugCalls.some((call: any[]) =>
        call[0].includes("OK") && call[0].includes("ms"),
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
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      class MyCustomService {}

      eventManager.on("echo", {
        callback: async () => {},
        caller: MyCustomService,
      });

      await eventManager.emit("echo", {}, { log: true });

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
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      eventManager.on("echo", async () => {});

      await eventManager.emit("echo", {}, { log: true });

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
        fatal: vi.fn(),
      };

      const eventManager = new EventManager(() => mockLogger);

      eventManager.on("echo", async () => {});

      await eventManager.emit("echo", {});

      expect(mockLogger.trace).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    it("should return unsubscribe function from on()", () => {
      const eventManager = new EventManager();
      const unsubscribe = eventManager.on("echo", async () => {});

      expect(typeof unsubscribe).toBe("function");
    });

    it("should remove handler when unsubscribe is called", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("echo", callback);
      unsubscribe();

      await eventManager.emit("echo", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should only remove specific handler", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = eventManager.on("echo", callback1);
      eventManager.on("echo", callback2);
      eventManager.on("echo", callback3);

      unsubscribe1();

      await eventManager.emit("echo", {});

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it("should allow multiple unsubscribe calls safely", async () => {
      const eventManager = new EventManager();
      const callback = vi.fn();

      const unsubscribe = eventManager.on("echo", callback);
      unsubscribe();
      unsubscribe(); // Should not throw

      await eventManager.emit("echo", {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should work with different events", async () => {
      const eventManager = new EventManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = eventManager.on("echo", callback1);
      eventManager.on("configure", callback2);

      unsubscribe1();

      await eventManager.emit("echo", {});
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

      alepha.events.on("echo", callback);
      await alepha.events.emit("echo", { custom: "data" });

      expect(callback).toHaveBeenCalledWith({ custom: "data" });
    });

    it("should work with custom hook types via module augmentation", async () => {
      const alepha = Alepha.create();
      const callback = vi.fn();

      // Using the 'echo' hook which is defined in Hooks interface
      alepha.events.on("echo", callback);
      await alepha.events.emit("echo", { test: true });

      expect(callback).toHaveBeenCalledWith({ test: true });
    });
  });

  describe("async behavior", () => {
    it("should wait for async callbacks to complete", async () => {
      const eventManager = new EventManager();
      let completed = false;

      eventManager.on("echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completed = true;
      });

      await eventManager.emit("echo", {});

      expect(completed).toBe(true);
    });

    it("should execute async callbacks sequentially", async () => {
      const eventManager = new EventManager();
      const order: string[] = [];

      eventManager.on("echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("first");
      });
      eventManager.on("echo", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("second");
      });

      await eventManager.emit("echo", {});

      // Second callback should wait for first to complete
      expect(order).toEqual(["first", "second"]);
    });

    it("should handle Promise rejections as errors", async () => {
      const eventManager = new EventManager();

      eventManager.on("echo", async () => {
        return Promise.reject(new Error("Async error"));
      });

      await expect(eventManager.emit("echo", {})).rejects.toThrow(
        "Async error",
      );
    });
  });
});
