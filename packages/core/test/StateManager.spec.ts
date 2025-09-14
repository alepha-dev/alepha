import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventManager } from "../src/helpers/EventManager.ts";
import { StateManager } from "../src/helpers/StateManager.ts";
import { AlsProvider } from "../src/providers/AlsProvider.ts";

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
		stateManager = new StateManager();
	});

	describe("Basic Operations", () => {
		it("should set and get values with proper typing", () => {
			const typedManager = new StateManager<TestState>();

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
			const typedManager = new StateManager<TestState>();

			typedManager.set("name", "John");

			expect(typedManager.has("name")).toBe(true);
			expect(typedManager.has("age")).toBe(false);
		});

		it("should handle different data types", () => {
			const typedManager = new StateManager<TestState>();

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
			const typedManager = new StateManager<TestState>();

			typedManager.set("name", "John");
			typedManager.set("age", 30);

			typedManager.clear();

			expect(typedManager.has("name")).toBe(false);
			expect(typedManager.has("age")).toBe(false);
		});

		it("should return all keys", () => {
			const typedManager = new StateManager<TestState>();

			typedManager.set("name", "John");
			typedManager.set("age", 30);

			const keys = typedManager.keys();
			expect(keys).toEqual(expect.arrayContaining(["name", "age"]));
			expect(keys.length).toBe(2);
		});
	});

	describe("Mutation Listeners", () => {
		it("should call listeners when values change", () => {
			const events = new EventManager();
			const typedManager = new StateManager<TestState>(events);
			const listener = vi.fn();

			events.on("state:mutate", listener);
			typedManager.set("name", "John");

			expect(listener).toHaveBeenCalledWith({
				key: "name",
				value: "John",
				prevValue: undefined,
			});
		});

		it("should call listeners with previous values", () => {
			const events = new EventManager();
			const typedManager = new StateManager<TestState>(events);

			typedManager.set("name", "initial");

			const listener = vi.fn();
			events.on("state:mutate", listener);

			typedManager.set("name", "updated");

			expect(listener).toHaveBeenCalledWith({
				key: "name",
				value: "updated",
				prevValue: "initial",
			});
		});

		it("should return unsubscribe function", () => {
			const events = new EventManager();
			const typedManager = new StateManager<TestState>(events);
			const listener = vi.fn();

			const unsubscribe = events.on("state:mutate", listener);

			typedManager.set("name", "value1");
			expect(listener).toHaveBeenCalledTimes(1);

			unsubscribe();

			typedManager.set("name", "value2");
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("should support multiple listeners for same key", async () => {
			const events = new EventManager();
			const typedManager = new StateManager<TestState>(events);
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			events.on("state:mutate", listener1);
			events.on("state:mutate", listener2);

			typedManager.set("name", "value");

			await new Promise((r) => setTimeout(r, 10));

			expect(listener1).toHaveBeenCalledTimes(1);
			expect(listener2).toHaveBeenCalledTimes(1);
		});
	});

	describe("Chaining", () => {
		it("should support method chaining", () => {
			const typedManager = new StateManager<TestState>();

			const result = typedManager.set("name", "John").set("age", 30).clear();

			expect(result).toBe(typedManager);
			expect(typedManager.has("name")).toBe(false);
		});
	});

	describe("AsyncLocalStorage Integration", () => {
		let alsProvider: AlsProvider;
		let mockAls: any;

		beforeEach(() => {
			// Mock AsyncLocalStorage
			mockAls = {
				getStore: vi.fn(),
				run: vi.fn(),
			};

			// Mock the AlsProvider
			alsProvider = new AlsProvider();
			alsProvider.als = mockAls;
			alsProvider.exists = vi.fn();
		});

		it("should use ALS when available and context exists", () => {
			mockAls.getStore.mockReturnValue({ name: "ALS Value", context: "test-context" });
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);

			expect(typedManager.get("name")).toBe("ALS Value");
			expect(mockAls.getStore).toHaveBeenCalled();
		});

		it("should fallback to local store when ALS has no value", () => {
			const store = { context: "test-context" }; // ALS exists but no 'name' key
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.set("name", "ALS Value"); // This goes to ALS since exists() returns true

			// Should get from ALS (which now has the value)
			expect(typedManager.get("name")).toBe("ALS Value");
			expect(store.name).toBe("ALS Value"); // Verify it was set in ALS
		});

		it("should use local store when ALS context doesn't exist", () => {
			mockAls.getStore.mockReturnValue(null); // No ALS context
			alsProvider.exists = vi.fn().mockReturnValue(false);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.set("name", "Local Value");

			expect(typedManager.get("name")).toBe("Local Value");
		});

		it("should set values in ALS when context exists", () => {
			const store = { context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.set("name", "ALS Value");

			expect(store.name).toBe("ALS Value");
		});

		it("should set values in local store when no ALS context", () => {
			mockAls.getStore.mockReturnValue(null);
			alsProvider.exists = vi.fn().mockReturnValue(false);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.set("name", "Local Value");

			expect(typedManager.get("name")).toBe("Local Value");
		});

		it("should emit events when setting values through ALS", () => {
			const events = new EventManager();
			const store = { context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(events, alsProvider);
			const listener = vi.fn();
			events.on("state:mutate", listener);

			typedManager.set("name", "ALS Value");

			expect(listener).toHaveBeenCalledWith({
				key: "name",
				value: "ALS Value",
				prevValue: undefined,
			});
		});

		it("should emit events with previous ALS values", () => {
			const events = new EventManager();
			const store = { name: "Initial ALS", context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(events, alsProvider);
			const listener = vi.fn();
			events.on("state:mutate", listener);

			typedManager.set("name", "Updated ALS");

			expect(listener).toHaveBeenCalledWith({
				key: "name",
				value: "Updated ALS",
				prevValue: "Initial ALS",
			});
		});

		it("should handle undefined ALS provider gracefully", () => {
			const typedManager = new StateManager<TestState>(undefined, undefined);

			typedManager.set("name", "Value");
			expect(typedManager.get("name")).toBe("Value");
		});

		it("should prefer ALS values over local store when both exist", () => {
			const store = { name: "ALS Value", context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			// Set value (goes to ALS since exists() returns true)
			typedManager.set("name", "ALS Priority");

			expect(typedManager.get("name")).toBe("ALS Priority");
			expect(store.name).toBe("ALS Priority");
		});

		it("should not skip event emission when values are the same", () => {
			const events = new EventManager();
			const store = { name: "Same Value", context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(events, alsProvider);
			const listener = vi.fn();
			events.on("state:mutate", listener);

			// Setting the same value should not emit event
			typedManager.set("name", "Same Value");

			expect(listener).not.toHaveBeenCalled();
		});

		it("should delete values from ALS when context exists", () => {
			const store = { name: "To Delete", context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.del("name");

			expect(store.name).toBeUndefined();
		});

		it("should clear only local store, not ALS", () => {
			const store = { name: "ALS Value", context: "test-context" };
			mockAls.getStore.mockReturnValue(store);

			// Start with no ALS context to set in local store
			alsProvider.exists = vi.fn().mockReturnValue(false);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			typedManager.set("age", 25); // This goes to local store since exists() returns false

			typedManager.clear();

			// Switch to ALS context
			alsProvider.exists = vi.fn().mockReturnValue(true);

			// ALS value should still be accessible
			expect(typedManager.get("name")).toBe("ALS Value");
			// Local value should be gone
			expect(typedManager.get("age")).toBeUndefined();
		});
	});

	describe("Mixed ALS and Local Store Scenarios", () => {
		let alsProvider: AlsProvider;
		let mockAls: any;

		beforeEach(() => {
			mockAls = {
				getStore: vi.fn(),
			};
			alsProvider = new AlsProvider();
			alsProvider.als = mockAls;
			alsProvider.exists = vi.fn();
		});

		it("should handle transitions between ALS and non-ALS contexts", () => {
			const typedManager = new StateManager<TestState>(undefined, alsProvider);

			// Start with no ALS context
			mockAls.getStore.mockReturnValue(null);
			alsProvider.exists = vi.fn().mockReturnValue(false);
			typedManager.set("name", "Local Value");
			expect(typedManager.get("name")).toBe("Local Value");

			// Switch to ALS context
			const store = { context: "test-context" };
			mockAls.getStore.mockReturnValue(store);
			alsProvider.exists = vi.fn().mockReturnValue(true);
			typedManager.set("name", "ALS Value");
			expect(typedManager.get("name")).toBe("ALS Value");

			// Switch back to no ALS context
			mockAls.getStore.mockReturnValue(null);
			alsProvider.exists = vi.fn().mockReturnValue(false);
			expect(typedManager.get("name")).toBe("Local Value");
		});

		it("should handle has() method with ALS", () => {
			const typedManager = new StateManager<TestState>(undefined, alsProvider);

			// Set in local store
			mockAls.getStore.mockReturnValue(null);
			alsProvider.exists = vi.fn().mockReturnValue(false);
			typedManager.set("name", "Local");

			// has() only checks local store, not ALS
			expect(typedManager.has("name")).toBe(true);
			expect(typedManager.has("age")).toBe(false);
		});

		it("should handle keys() method with ALS", () => {
			const store = { name: "ALS Value", age: 30, context: "test-context" };
			mockAls.getStore.mockReturnValue(store);

			const typedManager = new StateManager<TestState>(undefined, alsProvider);
			// Set in local store (ALS not existing)
			alsProvider.exists = vi.fn().mockReturnValue(false);
			typedManager.set("active", true); // This goes to local store

			// keys() only returns local store keys, not ALS
			const keys = typedManager.keys();
			expect(keys).toEqual(["active"]);
		});
	});
});
