import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { AlsProvider } from "../providers/AlsProvider.ts";

AlsProvider.create = () => new AsyncLocalStorage();

describe("fork", () => {
  it("should inherit parent state", () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    alepha.fork(() => {
      expect(alepha.get("test")).toBe("A");
    });
  });

  it("should isolate mutations from parent", () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    alepha.fork(() => {
      alepha.set("test", "B");
      expect(alepha.get("test")).toBe("B");
    });

    expect(alepha.get("test")).toBe("A");
  });

  it("should shadow the app value when a fork sets null", () => {
    // `get` nullish-coalesced the ALS value into the app store, so a fork
    // writing `null` ("logged out" for a nullable session atom) read the
    // app-level value back instead of its own.
    const alepha = new Alepha();
    alepha.set("test", "app-value" as any);

    alepha.fork(() => {
      alepha.set("test", null as any);
      expect(alepha.get("test")).toBeNull();
    });

    expect(alepha.get("test")).toBe("app-value");
  });

  it("should shadow the app value when a fork sets undefined", () => {
    const alepha = new Alepha();
    alepha.set("test", "app-value" as any);

    alepha.fork(() => {
      alepha.set("test", undefined as any);
      expect(alepha.get("test")).toBeUndefined();
    });

    expect(alepha.get("test")).toBe("app-value");
  });

  it("should walk up the tree through nested forks", () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    alepha.fork(() => {
      alepha.set("test", "B");

      alepha.fork(() => {
        // Walks up: current (not set) → parent ("B")
        expect(alepha.get("test")).toBe("B");
        alepha.set("test", "C");
        expect(alepha.get("test")).toBe("C");
      });

      expect(alepha.get("test")).toBe("B");
    });

    expect(alepha.get("test")).toBe("A");
  });

  it("should return the callback result", () => {
    const alepha = new Alepha();

    const result = alepha.fork(() => 42);
    expect(result).toBe(42);
  });

  it("should accept initial data", () => {
    const alepha = new Alepha();

    alepha.fork(
      () => {
        expect(alepha.get("seed")).toBe("hello");
      },
      { seed: "hello" },
    );
  });

  it("should not leak initial data to parent", () => {
    const alepha = new Alepha();

    alepha.fork(() => {}, { seed: "hello" });

    expect(alepha.get("seed")).toBeUndefined();
  });

  it("should handle async callbacks", async () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    await alepha.fork(async () => {
      alepha.set("test", "B");
      await new Promise((r) => setTimeout(r, 10));
      expect(alepha.get("test")).toBe("B");
    });

    expect(alepha.get("test")).toBe("A");
  });

  it("should isolate multiple parallel forks", async () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    await Promise.all([
      alepha.fork(async () => {
        alepha.set("test", "B");
        await new Promise((r) => setTimeout(r, 20));
        expect(alepha.get("test")).toBe("B");
      }),
      alepha.fork(async () => {
        alepha.set("test", "C");
        await new Promise((r) => setTimeout(r, 10));
        expect(alepha.get("test")).toBe("C");
      }),
    ]);

    expect(alepha.get("test")).toBe("A");
  });

  it("should fall back to app store for unset keys", () => {
    const alepha = new Alepha();
    alepha.set("parent", "value");

    alepha.fork(() => {
      alepha.set("child", "only");
      expect(alepha.get("parent")).toBe("value");
      expect(alepha.get("child")).toBe("only");
    });

    expect(alepha.get("child")).toBeUndefined();
  });
});

describe("nest", () => {
  it("should inherit the caller's state", () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    alepha.context.nest(() => {
      expect(alepha.get("test")).toBe("A");
    });
  });

  it("should isolate its writes from the caller", () => {
    const alepha = new Alepha();
    alepha.set("test", "A");

    alepha.context.nest(() => {
      alepha.set("test", "B");
      expect(alepha.get("test")).toBe("B");
    });

    expect(alepha.get("test")).toBe("A");
  });

  it("should capture writes even with no active context", () => {
    // The property the ORM relies on: outside a request there is no context,
    // and a write would otherwise land in the app-wide store where every
    // concurrent caller shares it.
    const alepha = new Alepha();
    alepha.set("test", "app-value" as any);

    alepha.context.nest(() => {
      alepha.set("test", "mine" as any);
      expect(alepha.get("test")).toBe("mine");
    });

    expect(alepha.get("test")).toBe("app-value");
  });

  it("should keep two concurrent nests apart", async () => {
    const alepha = new Alepha();

    await Promise.all([
      alepha.context.nest(async () => {
        alepha.set("test", "B");
        await new Promise((r) => setTimeout(r, 20));
        expect(alepha.get("test")).toBe("B");
      }),
      alepha.context.nest(async () => {
        alepha.set("test", "C");
        await new Promise((r) => setTimeout(r, 10));
        expect(alepha.get("test")).toBe("C");
      }),
    ]);

    expect(alepha.get("test")).toBeUndefined();
  });

  it("should survive a sibling that finishes first", async () => {
    // The shape of the transaction bug: the sibling's `finally` used to clear
    // a shared slot while this block was still using it.
    const alepha = new Alepha();
    let releaseSlow!: () => void;
    const slowMayFinish = new Promise<void>((r) => {
      releaseSlow = r;
    });

    const slow = alepha.context.nest(async () => {
      alepha.set("test", "slow");
      await slowMayFinish;
      return alepha.get("test");
    });

    await alepha.context.nest(async () => {
      alepha.set("test", "fast");
      alepha.set("test", undefined as any);
    });

    releaseSlow();
    expect(await slow).toBe("slow");
  });

  it("should keep the caller's correlation id", () => {
    // A new id here would detach everything the callback logs from the request
    // that caused it.
    const alepha = new Alepha();

    alepha.fork(() => {
      const outer = alepha.context.get("context");
      expect(outer).toBeDefined();

      alepha.context.nest(() => {
        expect(alepha.context.get("context")).toBe(outer);
      });
    });
  });

  it("should mint a correlation id when there is no caller to inherit from", () => {
    // Without one it does not register as a context, and `StateManager` writes
    // straight past the layer into the app store.
    const alepha = new Alepha();

    alepha.context.nest(() => {
      expect(alepha.context.exists()).toBe(true);
      expect(alepha.context.get("context")).toBeDefined();
    });
  });

  it("should reuse the caller's scoped registry", () => {
    // A registry of its own would hand the callback different `scoped`
    // instances than the caller is holding.
    const alepha = new Alepha();

    alepha.fork(() => {
      const registry = alepha.context.get("registry");
      expect(registry).toBeDefined();

      alepha.context.nest(() => {
        expect(alepha.context.get("registry")).toBe(registry);
        expect(alepha.context.get("registry", "current")).toBeUndefined();
      });
    });
  });

  it("should return the callback result", () => {
    const alepha = new Alepha();

    expect(alepha.context.nest(() => 42)).toBe(42);
  });
});

describe("fork scope", () => {
  it("should resolve across tree by default", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        alepha.set("x", 3);
        expect(alepha.get("x")).toBe(3);
      });
    });
  });

  it("should resolve app scope to root store", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        alepha.set("x", 3);
        expect(alepha.get("x", "app")).toBe(1);
      });
    });
  });

  it("should resolve parent scope to immediate parent layer", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        alepha.set("x", 3);
        expect(alepha.get("x", "parent")).toBe(2);
      });
    });
  });

  it("should return undefined for parent scope when key not set in parent", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.fork(() => {
        // Parent fork didn't set "x", so parent scope returns undefined
        expect(alepha.get("x", "parent")).toBeUndefined();
      });
    });
  });

  it("should return undefined for app scope when key not set in app", () => {
    const alepha = new Alepha();

    alepha.fork(() => {
      alepha.set("x", 2);
      expect(alepha.get("x", "app")).toBeUndefined();
    });
  });

  it("should walk full tree: L3 sees L2 value before L1", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        // Default: walks current (not set) → parent (2) → stops
        expect(alepha.get("x")).toBe(2);
        expect(alepha.get("x", "parent")).toBe(2);
        expect(alepha.get("x", "app")).toBe(1);
      });
    });
  });

  it("should not walk past parent when scope is parent", () => {
    const alepha = new Alepha();
    alepha.set("only-in-app", "root");

    alepha.fork(() => {
      alepha.fork(() => {
        // Parent didn't set it — scope: "parent" doesn't walk further
        expect(alepha.get("only-in-app", "parent")).toBeUndefined();
        // But default resolution walks to root
        expect(alepha.get("only-in-app")).toBe("root");
      });
    });
  });

  it("should resolve current scope to own layer only", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        alepha.set("x", 3);
        expect(alepha.get("x", "current")).toBe(3);
      });
    });
  });

  it("should return undefined for current scope when key not set in current layer", () => {
    const alepha = new Alepha();
    alepha.set("x", 1);

    alepha.fork(() => {
      alepha.set("x", 2);

      alepha.fork(() => {
        // Current layer didn't set "x", even though parent has it
        expect(alepha.get("x", "current")).toBeUndefined();
        // But default walks to parent
        expect(alepha.get("x")).toBe(2);
      });
    });
  });

  it("should handle 4 levels deep", () => {
    const alepha = new Alepha();
    alepha.set("x", "L0");

    alepha.fork(() => {
      alepha.set("x", "L1");

      alepha.fork(() => {
        alepha.set("x", "L2");

        alepha.fork(() => {
          alepha.set("x", "L3");

          expect(alepha.get("x")).toBe("L3");
          expect(alepha.get("x", "current")).toBe("L3");
          expect(alepha.get("x", "parent")).toBe("L2");
          expect(alepha.get("x", "app")).toBe("L0");
        });
      });
    });
  });
});
