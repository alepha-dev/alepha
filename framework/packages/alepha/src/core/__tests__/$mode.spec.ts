import { $hook, $inject, $module, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $mode } from "../primitives/$mode.ts";

describe("$mode", () => {
  it("should activate when direct env is set", async () => {
    class Target {
      mode = $mode({ env: "MIGRATE" });
    }

    const alepha = Alepha.create({ env: { MIGRATE: "true" } });
    alepha.with(Target);

    const target = alepha.inject(Target);
    expect(target.mode).toBe(true);
  });

  it("should activate when MODE env matches", async () => {
    class Target {
      mode = $mode({ env: "MIGRATE" });
    }

    // Use `new Alepha()` to avoid `process.env` overwriting MODE
    const alepha = new Alepha({ env: { MODE: "MIGRATE" } });
    alepha.with(Target);

    const target = alepha.inject(Target);
    expect(target.mode).toBe(true);
  });

  it("should return false when env does not match", async () => {
    class Target {
      mode = $mode({ env: "MIGRATE" });
    }

    const alepha = Alepha.create({ env: {} });
    alepha.with(Target);

    const target = alepha.inject(Target);
    expect(target.mode).toBe(false);
  });

  it("should prune unrelated services from graph", async () => {
    const stack: string[] = [];

    class Target {
      mode = $mode({ env: "MIGRATE" });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Target.start");
        },
      });
    }

    class Unrelated {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Unrelated.start");
        },
      });
    }

    const alepha = Alepha.create({ env: { MIGRATE: "true" } });
    alepha.with(Target).with(Unrelated);

    await alepha.start();

    expect(stack).toContain("Target.start");
    expect(stack).not.toContain("Unrelated.start");
  });

  it("should keep dependencies of the mode class", async () => {
    const stack: string[] = [];

    class Dep {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Dep.start");
        },
      });
    }

    class Target {
      dep = $inject(Dep);
      mode = $mode({ env: "SEED" });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Target.start");
        },
      });
    }

    const alepha = Alepha.create({ env: { SEED: "true" } });
    alepha.with(Target);

    await alepha.start();

    expect(stack).toContain("Dep.start");
    expect(stack).toContain("Target.start");
  });

  /**
   * The shape that broke `MIGRATE=true` for every ORM app: the target lives in
   * a module's `services` list, and depends on another service of the same
   * module. Rebuilding the pruned graph re-resolves that dependency, which
   * pulls the module in again — and the module's `register()` then re-injects
   * the target while it is still being constructed.
   */
  it("should keep a module-owned dependency without re-registering its module", async () => {
    class Dep {
      value = "dep";
    }

    class Target {
      dep = $inject(Dep);
      mode = $mode({ env: "PRUNE_MODULE" });
    }

    const TargetModule = $module({
      name: "test.prune.module",
      services: [Dep, Target],
    });

    const alepha = Alepha.create({ env: { PRUNE_MODULE: "true" } });
    alepha.with(TargetModule);

    await alepha.start();

    expect(alepha.inject(Target).dep.value).toBe("dep");
  });

  it("should fire ready callback then stop", async () => {
    let readyFired = false;

    class Target {
      mode = $mode({
        env: "MIGRATE",
        ready: async () => {
          readyFired = true;
        },
      });
    }

    const alepha = Alepha.create({ env: { MIGRATE: "true" } });
    alepha.with(Target);

    await alepha.start();

    expect(readyFired).toBe(true);
    expect(alepha.isStarted()).toBe(false);
  });

  it("should stop even if ready callback throws", async () => {
    class Target {
      mode = $mode({
        env: "MIGRATE",
        ready: async () => {
          throw new Error("boom");
        },
      });
    }

    const alepha = Alepha.create({ env: { MIGRATE: "true" } });
    alepha.with(Target);

    // The callback's own error: the event system used to wrap a failing hook
    // on the logging path, and no longer does on any.
    await expect(alepha.start()).rejects.toThrow("boom");
    expect(alepha.isStarted()).toBe(false);
  });

  it("should not prune when env does not match", async () => {
    const stack: string[] = [];

    class ModeClass {
      mode = $mode({ env: "MIGRATE" });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("ModeClass.start");
        },
      });
    }

    class Other {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Other.start");
        },
      });
    }

    const alepha = Alepha.create({ env: {} });
    alepha.with(ModeClass).with(Other);

    await alepha.start();

    // Both should fire — no pruning happened
    expect(stack).toContain("ModeClass.start");
    expect(stack).toContain("Other.start");
  });

  it("should preserve substitutions through prune", async () => {
    class Base {
      value = "base";
    }

    class Override extends Base {
      override value = "override";
    }

    class Target {
      dep = $inject(Base);
      mode = $mode({ env: "TEST_MODE" });
    }

    const alepha = Alepha.create({ env: { TEST_MODE: "true" } });
    alepha.with({ provide: Base, use: Override }).with(Target);

    await alepha.start();

    const target = alepha.inject(Target);
    expect(target.dep.value).toBe("override");
  });

  it("should skip .with() calls after target is set (early cutoff)", async () => {
    const stack: string[] = [];

    class Target {
      mode = $mode({ env: "MIGRATE" });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Target.start");
        },
      });
    }

    class LateRegistration {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("LateRegistration.start");
        },
      });
    }

    const alepha = Alepha.create({ env: { MIGRATE: "true" } });
    alepha.with(Target);
    // This .with() should be skipped because target is already set
    alepha.with(LateRegistration);

    await alepha.start();

    expect(stack).toContain("Target.start");
    expect(stack).not.toContain("LateRegistration.start");

    // LateRegistration should not be in the graph at all
    const graph = alepha.graph();
    expect(graph.LateRegistration).toBeUndefined();
  });

  it("should work without ready callback (long-running mode)", async () => {
    const stack: string[] = [];

    class WorkerMode {
      mode = $mode({ env: "WORKER" });

      onReady = $hook({
        on: "ready",
        handler: async () => {
          stack.push("WorkerMode.ready");
        },
      });
    }

    const alepha = Alepha.create({ env: { WORKER: "true" } });
    alepha.with(WorkerMode);

    await alepha.start();

    // Ready hook fires, but no auto-stop
    expect(stack).toContain("WorkerMode.ready");
    expect(alepha.isStarted()).toBe(true);

    await alepha.stop();
  });

  it.each(["false", "0", ""])(
    "should NOT activate when env value is %j",
    (value) => {
      class Target {
        mode = $mode({ env: "MIGRATE" });
      }

      const alepha = new Alepha({ env: { MIGRATE: value } });
      alepha.with(Target);

      expect(alepha.inject(Target).mode).toBe(false);
      expect(alepha.get("alepha.target")).toBeUndefined();
    },
  );

  it.each(["true", "1", "yes", "anything"])(
    "should activate when env value is %j",
    (value) => {
      class Target {
        mode = $mode({ env: "MIGRATE" });
      }

      const alepha = new Alepha({ env: { MIGRATE: value } });
      alepha.with(Target);

      expect(alepha.inject(Target).mode).toBe(true);
    },
  );
});

describe("Alepha#isEnvEnabled", () => {
  it("should treat absent, empty, 'false' and '0' as off", () => {
    const alepha = new Alepha({
      env: {
        EMPTY: "",
        FALSE: "false",
        FALSE_UPPER: "FALSE",
        ZERO: "0",
        SPACED: "  false  ",
        BOOL_FALSE: false,
      },
    });

    expect(alepha.isEnvEnabled("MISSING")).toBe(false);
    expect(alepha.isEnvEnabled("EMPTY")).toBe(false);
    expect(alepha.isEnvEnabled("FALSE")).toBe(false);
    expect(alepha.isEnvEnabled("FALSE_UPPER")).toBe(false);
    expect(alepha.isEnvEnabled("ZERO")).toBe(false);
    expect(alepha.isEnvEnabled("SPACED")).toBe(false);
    expect(alepha.isEnvEnabled("BOOL_FALSE")).toBe(false);
  });

  it("should treat any other value as on", () => {
    const alepha = new Alepha({
      env: {
        TRUE: "true",
        ONE: "1",
        WORD: "eu-west-3",
        BOOL_TRUE: true,
        NUMBER: 8080,
      },
    });

    expect(alepha.isEnvEnabled("TRUE")).toBe(true);
    expect(alepha.isEnvEnabled("ONE")).toBe(true);
    expect(alepha.isEnvEnabled("WORD")).toBe(true);
    expect(alepha.isEnvEnabled("BOOL_TRUE")).toBe(true);
    expect(alepha.isEnvEnabled("NUMBER")).toBe(true);
  });

  it("should apply to isCI", () => {
    expect(new Alepha({ env: { CI: "false" } }).isCI()).toBe(false);
    expect(new Alepha({ env: { CI: "true" } }).isCI()).toBe(true);
  });
});
