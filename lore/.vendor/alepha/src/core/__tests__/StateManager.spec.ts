import { AsyncLocalStorage } from "node:async_hooks";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Alepha } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { SchemaValidationError } from "../errors/SchemaValidationError.ts";
import { $atom } from "../primitives/$atom.ts";
import { $computed } from "../primitives/$computed.ts";
import { AlsProvider } from "../providers/AlsProvider.ts";
import { StateManager } from "../providers/StateManager.ts";
import { z } from "../providers/ZodProvider.ts";

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

      const result = typedManager.set("name", "John").set("age", 30).del("age");

      expect(result).toBe(typedManager);
      expect(typedManager.has("age")).toBe(false);
    });
  });

  describe("AsyncLocalStorage Integration", () => {
    let alepha: Alepha;
    let stateManager: StateManager<TestState>;

    beforeEach(() => {
      alepha = new Alepha();
      stateManager = alepha.store as unknown as StateManager<TestState>;
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
      // Note: AlsProvider spreads the store object, so we check values inside the callback
      const result = alepha.context.run(
        () => {
          stateManager.set("name", "ALS Value");
          return stateManager.get("name");
        },
        { context: "test-context" },
      );

      expect(result).toBe("ALS Value");
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
      const typedManager = Alepha.create().inject(StateManager<TestState>);

      typedManager.set("name", "Value");
      expect(typedManager.get("name")).toBe("Value");
    });

    it("should prefer ALS values over local store when both exist", async () => {
      // Set value in local store first
      stateManager.set("name", "Local Value");

      // In ALS context, ALS values should take priority
      // Note: AlsProvider spreads the store object, so we check values inside the callback
      const result = alepha.context.run(
        () => {
          stateManager.set("name", "ALS Priority");
          return stateManager.get("name");
        },
        { context: "test-context" },
      );

      expect(result).toBe("ALS Priority");
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
      // Note: AlsProvider spreads the store object, so we check values inside the callback
      const result = alepha.context.run(
        () => {
          stateManager.set("name", "To Delete");
          stateManager.del("name");
          return stateManager.get("name");
        },
        { context: "test-context" },
      );

      expect(result).toBeUndefined();
    });
  });

  describe("Atom Validation", () => {
    const prefs = $atom({
      name: "test.validation.prefs",
      schema: z.object({ theme: z.string(), count: z.number() }),
      default: { theme: "light", count: 0 },
    });

    it("rejects a write that violates the schema", () => {
      const alepha = Alepha.create();
      expect(() =>
        alepha.store.set(prefs, { theme: "dark", count: "nope" } as any),
      ).toThrow(SchemaValidationError);
    });

    it("strips unknown keys on write", () => {
      const alepha = Alepha.create();
      alepha.store.set(prefs, { theme: "dark", count: 1, extra: true } as any);
      expect(alepha.store.get(prefs)).toEqual({ theme: "dark", count: 1 });
    });

    it("validates writes made through the raw string key once registered", () => {
      const alepha = Alepha.create();
      alepha.store.get(prefs); // registers the atom
      expect(() =>
        alepha.store.set("test.validation.prefs" as any, { theme: 1 } as any),
      ).toThrow();
    });

    it("skips validation when skipValidation is set", () => {
      const alepha = Alepha.create();
      alepha.store.get(prefs);
      alepha.store.set("test.validation.prefs" as any, { theme: 1 } as any, {
        skipValidation: true,
      });
      expect((alepha.store.get(prefs) as any).theme).toBe(1);
    });

    it("falls back to the default when a pre-seeded value is invalid", () => {
      const alepha = Alepha.create({
        "test.validation.prefs": { theme: 42 },
      } as any);
      expect(alepha.store.get(prefs)).toEqual({ theme: "light", count: 0 });
    });

    it("warns when a pre-seeded value is invalid and falls back to the default", () => {
      const warn = vi.fn();
      const alepha = Alepha.create({
        "test.validation.prefs": { theme: 42 },
        "alepha.logger": {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn,
          error: vi.fn(),
        },
      } as any);

      expect(alepha.store.get(prefs)).toEqual({ theme: "light", count: 0 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("test.validation.prefs");
    });

    it("decodes a valid pre-seeded value through the schema", () => {
      const alepha = Alepha.create({
        "test.validation.prefs": { theme: "dark", count: 2, junk: 1 },
      } as any);
      expect(alepha.store.get(prefs)).toEqual({ theme: "dark", count: 2 });
    });

    it("exposes registered atoms via getAtom", () => {
      const alepha = Alepha.create();
      alepha.store.get(prefs);
      expect(alepha.store.getAtom("test.validation.prefs")).toBeDefined();
      expect(alepha.store.getAtom("nope")).toBeUndefined();
    });
  });

  describe("ALS-aware decode-at-registration", () => {
    const settings = $atom({
      name: "test.validation.als.settings",
      schema: z.object({ theme: z.string(), count: z.number() }),
      default: { theme: "light", count: 0 },
    });

    it("decodes a value written into a request-scoped ALS layer before the atom registers, in place", () => {
      const alepha = Alepha.create();

      const result = alepha.context.run(
        () => {
          // Simulate a fork-scoped write landing ahead of the atom's first
          // access (e.g. $cookie mirroring a cookie value into the store
          // during server:onRequest, before anything reads the atom).
          alepha.store.set(
            settings.key as any,
            {
              theme: "dark",
              count: 1,
              extra: true,
            } as any,
          );
          return alepha.store.get(settings);
        },
        { context: "req-1" },
      );

      expect(result).toEqual({ theme: "dark", count: 1 });
      // The fork's value must not have leaked into the app-level store...
      expect(alepha.store.get(settings, "app")).not.toEqual({
        theme: "dark",
        count: 1,
      });
      // ...but the app-level store MUST still have received the atom's
      // declared default. Registration inside a fork is still a
      // registration: leaving the app store empty here is what made every
      // later, fork-less (or cookie-less) read resolve `undefined` instead
      // of the default.
      expect(alepha.store.get(settings, "app")).toEqual({
        theme: "light",
        count: 0,
      });
    });

    it("still resolves the default outside the fork after an atom first registered inside one", () => {
      const alepha = Alepha.create();

      alepha.context.run(
        () => {
          alepha.store.set(
            settings.key as any,
            {
              theme: "dark",
              count: 1,
            } as any,
          );
          // First registration happens here, inside the fork.
          alepha.store.get(settings);
        },
        { context: "req-1" },
      );

      // A later request (a different fork) carrying no seed of its own, and
      // the app-level read outside any fork, both see the default.
      const next = alepha.context.run(() => alepha.store.get(settings), {
        context: "req-2",
      });

      expect(next).toEqual({ theme: "light", count: 0 });
      expect(alepha.store.get(settings)).toEqual({ theme: "light", count: 0 });
    });

    it("falls back to the default inside the same ALS layer (not the app store) when the seeded value is invalid, and warns", () => {
      const warn = vi.fn();
      const alepha = Alepha.create({
        "alepha.logger": {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn,
          error: vi.fn(),
        },
      } as any);

      const result = alepha.context.run(
        () => {
          alepha.store.set(settings.key as any, { theme: 42 } as any);
          return alepha.store.get(settings);
        },
        { context: "req-1" },
      );

      expect(result).toEqual({ theme: "light", count: 0 });
      expect(warn).toHaveBeenCalledTimes(1);
      // The invalid seed was replaced inside the ALS layer, and the app
      // store holds the declared default (never the fork's value).
      expect(alepha.store.get(settings, "app")).toEqual({
        theme: "light",
        count: 0,
      });
    });

    it("hands out a fresh copy of the default when a seeded value is invalid — never the shared declaration", () => {
      const alepha = Alepha.create();

      const result = alepha.context.run(
        () => {
          alepha.store.set(settings.key as any, { theme: 42 } as any);
          return alepha.store.get(settings);
        },
        { context: "req-1" },
      );

      // A careless caller mutates the value it got back from the
      // fallback-to-default path.
      (result as { count: number }).count = 424242;

      // `atom.options.default` is a module-level object shared by every
      // container in the process. If the fallback aliased it instead of
      // cloning it through the validator, that mutation would have rewritten
      // the declaration itself — permanently, for every request.
      expect(settings.options.default).toEqual({ theme: "light", count: 0 });

      const fresh = Alepha.create();
      expect(fresh.store.get(settings)).toEqual({ theme: "light", count: 0 });
    });

    it("decodes a value that landed in a parent fork layer before a nested fork registers the atom", () => {
      const alepha = Alepha.create();

      const result = alepha.context.run(
        () => {
          alepha.store.set(
            settings.key as any,
            {
              theme: "dark",
              count: 5,
            } as any,
          );

          // A nested fork (e.g. a batched sub-request) is the one that
          // first accesses the atom — the raw value lives one layer up.
          return alepha.context.run(() => alepha.store.get(settings), {
            context: "req-1-child",
          });
        },
        { context: "req-1" },
      );

      expect(result).toEqual({ theme: "dark", count: 5 });
    });
  });

  describe("Mixed ALS and Local Store Scenarios", () => {
    let alepha: Alepha;
    let stateManager: StateManager<TestState>;

    beforeEach(() => {
      alepha = new Alepha();
      stateManager = alepha.store as unknown as StateManager<TestState>;
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
      const keys = alepha.store.keys();
      expect(keys).toEqual(["active"]);
    });
  });

  describe("Reset, Watch, ServerOnly", () => {
    const counter = $atom({
      name: "test.extras.counter",
      schema: z.object({ value: z.number() }),
      default: { value: 0 },
    });

    const secret = $atom({
      name: "test.extras.secret",
      schema: z.object({ token: z.string() }),
      default: { token: "" },
      serverOnly: true,
    });

    const doubledCounter = $computed({
      name: "test.extras.doubled",
      deps: [counter],
      get: (c) => c.value * 2,
    });

    const other = $atom({
      name: "test.extras.other",
      schema: z.object({ value: z.number() }),
      default: { value: 0 },
    });

    const total = $computed({
      name: "test.extras.total",
      deps: [counter, other],
      get: (c, o) => c.value + o.value,
    });

    it("reset restores the declared default", () => {
      const alepha = Alepha.create();
      alepha.store.set(counter, { value: 99 });
      alepha.store.reset(counter);
      expect(alepha.store.get(counter)).toEqual({ value: 0 });
    });

    it("reset is exposed on the Alepha instance", () => {
      const alepha = Alepha.create();
      alepha.store.set(counter, { value: 99 });
      alepha.reset(counter);
      expect(alepha.get(counter)).toEqual({ value: 0 });
    });

    it("watch fires with value and previous value", async () => {
      const alepha = Alepha.create();
      const calls: Array<[unknown, unknown]> = [];

      alepha.store.watch(counter, (value, prevValue) => {
        calls.push([value, prevValue]);
      });

      alepha.store.set(counter, { value: 1 });
      await new Promise((r) => setTimeout(r, 0));

      expect(calls).toEqual([[{ value: 1 }, { value: 0 }]]);
    });

    it("watch returns an unsubscribe function", async () => {
      const alepha = Alepha.create();
      const calls: unknown[] = [];

      const off = alepha.store.watch(counter, (value) => {
        calls.push(value);
      });
      off();

      alepha.store.set(counter, { value: 1 });
      await new Promise((r) => setTimeout(r, 0));

      expect(calls).toEqual([]);
    });

    it("watch supports computed values", async () => {
      const alepha = Alepha.create();
      const calls: Array<[unknown, unknown]> = [];

      alepha.store.watch(doubledCounter, (value, prevValue) => {
        calls.push([value, prevValue]);
      });

      alepha.store.set(counter, { value: 5 });
      await new Promise((r) => setTimeout(r, 0));

      expect(calls).toEqual([[10, 0]]);
    });

    it("register refuses a Computed, so it can never reach exportAtoms", () => {
      const alepha = Alepha.create();

      // `reset()`/`register()` are the only atom entry points that took a
      // Computed without complaint. A registered Computed would land in the
      // atom registry and from there be serialized into the SSR hydration
      // payload — breaking the "never stored, never serialized" contract.
      expect(() => alepha.store.reset(doubledCounter as any)).toThrow(
        AlephaError,
      );
      expect(() => alepha.store.register(doubledCounter as any)).toThrow(
        /Cannot register computed value/,
      );
      expect(alepha.store.getAtom("test.extras.doubled")).toBeUndefined();
      expect(alepha.store.exportAtoms()["test.extras.doubled"]).toBeUndefined();
    });

    it("serverOnly atoms are excluded from exportAtoms", () => {
      const alepha = Alepha.create();
      alepha.store.set(counter, { value: 1 });
      alepha.store.set(secret, { token: "s3cret" });

      const exported = alepha.store.exportAtoms();
      expect(exported["test.extras.counter"]).toEqual({ value: 1 });
      expect(exported["test.extras.secret"]).toBeUndefined();
    });

    it("serverOnly atoms are excluded from exportAtoms('current') — the ALS/SSR branch", () => {
      // This is the branch ReactServerTemplateProvider.buildHydrationData()
      // actually calls during SSR (exportAtoms("current")), serializing the
      // result straight into the <script id="__ssr"> hydration payload. The
      // default-branch test above does not exercise this code path at all.
      const alepha = Alepha.create();

      const exported = alepha.context.run(
        () => {
          alepha.store.set(counter, { value: 7 });
          alepha.store.set(secret, { token: "s3cret" });
          return alepha.store.exportAtoms("current");
        },
        { context: "test.extras.ssr-fork" },
      );

      expect(exported["test.extras.counter"]).toEqual({ value: 7 });
      expect(exported["test.extras.secret"]).toBeUndefined();
    });

    it("watch on a computed tracks prevValue correctly across two different dependency keys", async () => {
      const alepha = Alepha.create();
      const calls: Array<[unknown, unknown]> = [];

      alepha.store.watch(total, (value, prevValue) => {
        calls.push([value, prevValue]);
      });

      // Mutate the first dep key.
      alepha.store.set(counter, { value: 3 });
      await new Promise((r) => setTimeout(r, 0));

      // Then mutate a *different* dep key. The computed's own `prev` must
      // have been updated after the first callback, or this second call
      // would report a stale prevValue.
      alepha.store.set(other, { value: 4 });
      await new Promise((r) => setTimeout(r, 0));

      expect(calls).toEqual([
        [3, 0],
        [7, 3],
      ]);
    });

    it("reset's clone of the default cannot corrupt future resets (zod parse always returns a fresh object)", () => {
      const alepha = Alepha.create();
      alepha.store.set(counter, { value: 99 });
      alepha.store.reset(counter);

      const resetValue = alepha.store.get(counter);
      expect(resetValue).toEqual({ value: 0 });

      // A careless caller mutates the value handed back by reset/get.
      (resetValue as { value: number }).value = 424242;

      // The atom's declared default itself must be untouched: `reset()` ->
      // `set()` -> `SchemaValidator.validate()` runs `schema.safeParse()`,
      // and zod's object parsing always returns a brand-new object, never
      // the same reference as `atom.options.default` — even when the input
      // is already valid. So the mutation above can never reach here.
      expect(counter.options.default).toEqual({ value: 0 });

      // Prove it end-to-end too: a fresh container resets to the pristine
      // default, unaffected by the mutation performed above.
      const freshAlepha = Alepha.create();
      freshAlepha.store.set(counter, { value: 1 });
      freshAlepha.store.reset(counter);
      expect(freshAlepha.store.get(counter)).toEqual({ value: 0 });
    });
  });

  describe("del", () => {
    it("should remove the key from the app-level store", () => {
      const alepha = new Alepha();
      alepha.store.set("foo", 1 as any);
      expect(alepha.store.has("foo")).toBe(true);

      alepha.store.del("foo");
      expect(alepha.store.has("foo")).toBe(false);
      expect(alepha.store.keys()).not.toContain("foo");
      expect(alepha.store.get("foo")).toBeUndefined();
    });

    it("should shadow the app-level value inside a fork", () => {
      const alepha = new Alepha();
      alepha.store.set("foo", "app" as any);

      alepha.fork(() => {
        alepha.store.del("foo");
        // The fork owns the deletion: reads resolve undefined, not "app".
        expect(alepha.store.get("foo")).toBeUndefined();
      });

      // The app-level value survives the fork.
      expect(alepha.store.get("foo")).toBe("app");
    });
  });
});
