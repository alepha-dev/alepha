import { $hook, $inject, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("$hook", () => {
  it("should track hook calls", async () => {
    class App {
      hook = $hook({
        on: "echo",
        handler: () => {},
      });
    }
    const alepha = Alepha.create().with(App);
    await alepha.start();
    expect(alepha.inject(App).hook.called).toBe(0);
    await alepha.events.emit("echo", {});
    expect(alepha.inject(App).hook.called).toBe(1);
    await alepha.events.emit("echo", {});
    expect(alepha.inject(App).hook.called).toBe(2);
  });

  it("should handle service substitution", async () => {
    let count = 0;

    class Interface {
      n = 10;
      c = $hook({
        on: "configure",
        handler: () => {
          count += this.n;
        },
      });
    }

    const app = new Alepha();

    expect(count).toBe(0);

    class Impl extends Interface {
      n = 1;
      id = Math.random();
    }

    app.with({
      provide: Interface,
      use: Impl, // expects to be swapped, event from "Interface" will be deleted
    });

    expect(count).toBe(0);

    await app.start();

    expect(count).toBe(1);
  });

  it("should respect priority, before, and after ordering", async () => {
    let stack = "";

    class A {
      _ = $hook({
        on: "configure",
        handler: () => {
          stack += "A";
        },
      });
    }

    class B {
      a = $inject(A);
      _ = $hook({
        on: "configure",
        after: [this.a],
        handler: () => {
          stack += "B";
        },
      });
    }

    class C {
      b = $inject(B);
      _ = $hook({
        on: "configure",
        after: [this.b],
        handler: () => {
          stack += "C";
        },
      });
    }

    class D {
      b = $inject(B);
      c = $inject(C);
      _ = $hook({
        on: "configure",
        after: [this.b, this.c],
        handler: () => {
          stack += "D";
        },
      });
    }

    class F {
      _ = $hook({
        priority: "last",
        on: "configure",
        handler: () => {
          stack += "F";
        },
      });
    }

    class E {
      d = $inject(D);
      f = $inject(F);
      _ = $hook({
        on: "configure",
        after: [this.d],
        before: [this.f],
        handler: () => {
          stack += "E";
        },
      });
    }

    const alepha = Alepha.create().with(F).with(B).with(E);

    await alepha.start();

    expect(stack).toBe("ABCDEF");
  });
});

describe("$hook after start", () => {
  it("should refuse a $hook on a service instantiated after start", async () => {
    class ScopedWithHook {
      onEcho = $hook({
        on: "echo",
        handler: () => {},
      });
    }

    const alepha = new Alepha();
    await alepha.start();

    // A scoped injection inside a request fork is the reachable way to
    // instantiate a service post-start; each one used to leak its hook on
    // the app-level EventManager forever.
    expect(() =>
      alepha.fork(() => alepha.inject(ScopedWithHook, { lifetime: "scoped" })),
    ).toThrow(/after Alepha has started/);

    await alepha.stop();
  });
});
