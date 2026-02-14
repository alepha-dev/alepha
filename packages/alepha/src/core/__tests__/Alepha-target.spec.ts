import { $hook, $inject, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("alepha.target", () => {
  it("should only keep target class in the graph", async () => {
    class A {
      value = "a";
    }

    class B {
      value = "b";
    }

    const alepha = Alepha.create();
    alepha.with(A).with(B);

    // Set target to A — B should be pruned
    alepha.set("alepha.target", A);

    await alepha.start();

    const graph = alepha.graph();
    expect(graph.A).toBeDefined();
    expect(graph.B).toBeUndefined();
  });

  it("should keep transitive dependencies of the target", async () => {
    class Dep {
      value = "dep";
    }

    class Target {
      dep = $inject(Dep);
    }

    class Unrelated {
      value = "unrelated";
    }

    const alepha = Alepha.create();
    alepha.with(Target).with(Unrelated);

    alepha.set("alepha.target", Target);

    await alepha.start();

    const graph = alepha.graph();
    expect(graph.Target).toBeDefined();
    expect(graph.Dep).toBeDefined();
    expect(graph.Unrelated).toBeUndefined();
  });

  it("should only fire hooks from target and its dependencies", async () => {
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

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Target.start");
        },
      });
    }

    class Pruned {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Pruned.start");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(Target).with(Pruned);
    alepha.set("alepha.target", Target);

    await alepha.start();

    expect(stack).toContain("Dep.start");
    expect(stack).toContain("Target.start");
    expect(stack).not.toContain("Pruned.start");
  });

  it("should not fire configure/ready hooks from pruned services", async () => {
    const stack: string[] = [];

    class Target {
      onConfigure = $hook({
        on: "configure",
        handler: async () => {
          stack.push("Target.configure");
        },
      });

      onReady = $hook({
        on: "ready",
        handler: async () => {
          stack.push("Target.ready");
        },
      });
    }

    class Pruned {
      onConfigure = $hook({
        on: "configure",
        handler: async () => {
          stack.push("Pruned.configure");
        },
      });

      onReady = $hook({
        on: "ready",
        handler: async () => {
          stack.push("Pruned.ready");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(Target).with(Pruned);
    alepha.set("alepha.target", Target);

    await alepha.start();

    expect(stack).toEqual(["Target.configure", "Target.ready"]);
  });

  it("should not fire stop hooks from pruned services", async () => {
    const stack: string[] = [];

    class Target {
      onStop = $hook({
        on: "stop",
        handler: async () => {
          stack.push("Target.stop");
        },
      });
    }

    class Pruned {
      onStop = $hook({
        on: "stop",
        handler: async () => {
          stack.push("Pruned.stop");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(Target).with(Pruned);
    alepha.set("alepha.target", Target);

    await alepha.start();
    await alepha.stop();

    expect(stack).toContain("Target.stop");
    expect(stack).not.toContain("Pruned.stop");
  });

  it("should preserve substitutions relevant to the target", async () => {
    class Base {
      value = "base";
    }

    class Override extends Base {
      override value = "override";
    }

    class Target {
      dep = $inject(Base);
    }

    const alepha = Alepha.create();
    alepha.with({ provide: Base, use: Override }).with(Target);
    alepha.set("alepha.target", Target);

    await alepha.start();

    const target = alepha.inject(Target);
    expect(target.dep.value).toBe("override");
  });

  it("should work with deep dependency chains", async () => {
    const stack: string[] = [];

    class C {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("C");
        },
      });
    }

    class B {
      c = $inject(C);

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("B");
        },
      });
    }

    class A {
      b = $inject(B);

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("A");
        },
      });
    }

    class Unrelated {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Unrelated");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(A).with(Unrelated);
    alepha.set("alepha.target", A);

    await alepha.start();

    expect(stack).toContain("A");
    expect(stack).toContain("B");
    expect(stack).toContain("C");
    expect(stack).not.toContain("Unrelated");
  });

  it("should set alepha.target from a constructor", async () => {
    const stack: string[] = [];

    class Target {
      protected alepha = $inject(Alepha);

      constructor() {
        this.alepha.set("alepha.target", Target);
      }

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Target.start");
        },
      });
    }

    class Pruned {
      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("Pruned.start");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(Target).with(Pruned);

    await alepha.start();

    expect(stack).toEqual(["Target.start"]);
  });
});
