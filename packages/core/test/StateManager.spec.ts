import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Alepha } from "../src/Alepha.ts";
import { AlsProvider } from "../src/providers/AlsProvider.ts";
import { StateManager } from "../src/providers/StateManager.ts";

// Set up AsyncLocalStorage for tests
AlsProvider.create = () => new AsyncLocalStorage();

// Test with custom state interface
interface TestState {
  name?: string;
  age?: number;
  active?: boolean;
  config?: {
    theme: string;
  };
}

describe("StateManager", () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = Alepha.create().inject(StateManager);
  });

  describe("Basic Operations", () => {
    it("should set and get values with proper typing", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);

      typedManager.set("name", "John");
      typedManager.set("age", 30);
      typedManager.set("active", true);

      expect(typedManager.get("name")).toBe("John");
      expect(typedManager.get("age")).toBe(30);
      expect(typedManager.get("active")).toBe(true);
    });

    it("should return undefined for non-existent keys", () => {
      expect(stateManager.get("nonExistent" as any)).toBeUndefined();
    });

    it("should check if keys exist", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      typedManager.set("name", "John");

      expect(typedManager.has("name")).toBe(true);
      expect(typedManager.has("age")).toBe(false);
    });

    it("should handle different data types", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      typedManager.set("name", "hello");
      typedManager.set("age", 42);
      typedManager.set("active", true);
      typedManager.set("config", { theme: "dark" });

      expect(typedManager.get("name")).toBe("hello");
      expect(typedManager.get("age")).toBe(42);
      expect(typedManager.get("active")).toBe(true);
      expect(typedManager.get("config")).toEqual({ theme: "dark" });
    });

    it("should clear all state", () => {
      const typedManager = Alepha.create().inject(StateManager);

      typedManager.set("name", "John");
      typedManager.set("age", 30);

      typedManager.clear();

      expect(typedManager.has("name")).toBe(false);
      expect(typedManager.has("age")).toBe(false);
    });

    it("should return all keys", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      typedManager.set("name", "John");
      typedManager.set("age", 30);

      const keys = typedManager.keys();
      expect(keys).toEqual(expect.arrayContaining(["name", "age"]));
      expect(keys.length).toBe(2);
    });
  });

  describe("Mutation Listeners", () => {
    it("should call listeners when values change", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      const listener = vi.fn();

      alepha.events.on("state:mutate", listener);
      typedManager.set("name", "John");

      expect(listener).toHaveBeenCalledWith({
        key: "name",
        value: "John",
        prevValue: undefined,
      });
    });

    it("should call listeners with previous values", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);

      typedManager.set("name", "initial");

      const listener = vi.fn();
      alepha.events.on("state:mutate", listener);

      typedManager.set("name", "updated");

      expect(listener).toHaveBeenCalledWith({
        key: "name",
        value: "updated",
        prevValue: "initial",
      });
    });

    it("should return unsubscribe function", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      const listener = vi.fn();

      const unsubscribe = alepha.events.on("state:mutate", listener);

      typedManager.set("name", "value1");
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      typedManager.set("name", "value2");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listeners for same key", async () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      alepha.events.on("state:mutate", listener1);
      alepha.events.on("state:mutate", listener2);

      typedManager.set("name", "value");

      await new Promise((r) => setTimeout(r, 10));

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("Chaining", () => {
    it("should support method chaining", () => {
      const alepha = new Alepha();
      const typedManager = alepha.inject(StateManager<TestState>);

      const result = typedManager.set("name", "John").set("age", 30).clear();

      expect(result).toBe(typedManager);
      expect(typedManager.has("name")).toBe(false);
    });
  });

  describe("AsyncLocalStorage Integration", () => {
    let alepha: Alepha;
    let stateManager: StateManager<TestState>;

    beforeEach(() => {
      alepha = new Alepha();
      stateManager = alepha.state as StateManager<TestState>;
    });

    it("should use ALS when available and context exists", async () => {
      // Set up ALS context with some initial state
      const testValue = alepha.context.run(
        () => {
          return stateManager.get("name");
        },
        { name: "ALS Value", context: "test-context" },
      );

      expect(testValue).toBe("ALS Value");
    });

    it("should set and get values within ALS context", async () => {
      const result = alepha.context.run(
        () => {
          stateManager.set("name", "ALS Value");
          return stateManager.get("name");
        },
        { context: "test-context" },
      );

      expect(result).toBe("ALS Value");
    });

    it("should use local store when ALS context doesn't exist", () => {
      // Outside of ALS context, should use local store
      stateManager.set("name", "Local Value");
      expect(stateManager.get("name")).toBe("Local Value");
    });

    it("should set values in ALS when context exists", async () => {
      const store: any = { context: "test-context" };
      alepha.context.run(() => {
        stateManager.set("name", "ALS Value");
      }, store);

      expect(store.name).toBe("ALS Value");
    });

    it("should set values in local store when no ALS context", () => {
      // Outside ALS context, values go to local store
      stateManager.set("name", "Local Value");
      expect(stateManager.get("name")).toBe("Local Value");
    });

    it("should emit events when setting values through ALS", async () => {
      const listener = vi.fn();
      alepha.events.on("state:mutate", listener);

      const store = { context: "test-context" };
      alepha.context.run(() => {
        stateManager.set("name", "ALS Value");
      }, store);

      expect(listener).toHaveBeenCalledWith({
        key: "name",
        value: "ALS Value",
        prevValue: undefined,
      });
    });

    it("should emit events with previous ALS values", async () => {
      const listener = vi.fn();
      alepha.events.on("state:mutate", listener);

      const store = { name: "Initial ALS", context: "test-context" };
      alepha.context.run(() => {
        stateManager.set("name", "Updated ALS");
      }, store);

      expect(listener).toHaveBeenCalledWith({
        key: "name",
        value: "Updated ALS",
        prevValue: "Initial ALS",
      });
    });

    it("should handle state manager without ALS provider", () => {
      const typedManager = Alepha.create().inject(StateManager);

      typedManager.set("name", "Value");
      expect(typedManager.get("name")).toBe("Value");
    });

    it("should prefer ALS values over local store when both exist", async () => {
      // Set value in local store first
      stateManager.set("name", "Local Value");

      // In ALS context, ALS values should take priority
      const store: any = { context: "test-context" };
      const result = alepha.context.run(() => {
        stateManager.set("name", "ALS Priority");
        return stateManager.get("name");
      }, store);

      expect(result).toBe("ALS Priority");
      expect(store.name).toBe("ALS Priority");
    });

    it("should not skip event emission when values are the same", async () => {
      const listener = vi.fn();
      alepha.events.on("state:mutate", listener);

      const store = { name: "Same Value", context: "test-context" };
      alepha.context.run(() => {
        // Setting the same value should not emit event
        stateManager.set("name", "Same Value");
      }, store);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should delete values from ALS when context exists", async () => {
      const store = { name: "To Delete", context: "test-context" };
      alepha.context.run(() => {
        stateManager.del("name");
      }, store);

      expect(store.name).toBeUndefined();
    });

    it("should clear only local store, not ALS", async () => {
      // Set value in local store
      stateManager.set("age", 25);

      // Clear local store
      stateManager.clear();

      // ALS value should still be accessible within ALS context
      const store = { name: "ALS Value", context: "test-context" };
      const result = alepha.context.run(() => {
        return stateManager.get("name");
      }, store);

      expect(result).toBe("ALS Value");
      // Local value should be gone
      expect(stateManager.get("age")).toBeUndefined();
    });
  });

  describe("Mixed ALS and Local Store Scenarios", () => {
    let alepha: Alepha;
    let stateManager: StateManager<TestState>;

    beforeEach(() => {
      alepha = new Alepha();
      stateManager = alepha.state as StateManager<TestState>;
    });

    it("should handle transitions between ALS and non-ALS contexts", async () => {
      // Start with no ALS context
      stateManager.set("name", "Local Value");
      expect(stateManager.get("name")).toBe("Local Value");

      // Switch to ALS context
      const store = { context: "test-context" };
      const alsResult = alepha.context.run(() => {
        stateManager.set("name", "ALS Value");
        return stateManager.get("name");
      }, store);
      expect(alsResult).toBe("ALS Value");

      // Outside ALS context, should see local value again
      expect(stateManager.get("name")).toBe("Local Value");
    });

    it("should handle has() method with local store", () => {
      // Set in local store
      stateManager.set("name", "Local");

      // has() checks local store
      expect(stateManager.has("name")).toBe(true);
      expect(stateManager.has("age")).toBe(false);
    });

    it("should handle keys() method with local store", () => {
      // Set in local store
      stateManager.set("active", true);

      // keys() returns local store keys
      const keys = alepha.state.keys();
      expect(keys).toEqual(["active"]);
    });
  });
});
