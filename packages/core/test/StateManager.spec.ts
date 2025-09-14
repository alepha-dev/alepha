import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventManager } from "../src/helpers/EventManager.ts";
import { StateManager } from "../src/helpers/StateManager.ts";

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
});
