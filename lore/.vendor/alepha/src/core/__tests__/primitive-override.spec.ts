import { $hook, Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

type HookEvent = "echo" | "configure" | "ready";

describe("Primitive.override", () => {
  it("should shallow-merge partial options", () => {
    class App {
      hook = $hook({
        on: "echo" as HookEvent,
        handler: () => {},
      });
    }
    const alepha = Alepha.create().with(App);
    const app = alepha.inject(App);

    app.hook.override({ on: "configure" });

    expect(app.hook.options.on).toBe("configure");
    // handler preserved (not touched by override)
    expect(typeof app.hook.options.handler).toBe("function");
  });

  it("should be chainable and return this", () => {
    class App {
      hook = $hook({
        on: "echo" as HookEvent,
        handler: () => {},
      });
    }
    const alepha = Alepha.create().with(App);
    const app = alepha.inject(App);

    const result = app.hook
      .override({ on: "configure" })
      .override({ on: "ready" });

    expect(result).toBe(app.hook);
    expect(app.hook.options.on).toBe("ready");
  });

  it("should throw AlephaError after alepha has started", async () => {
    class App {
      hook = $hook({
        on: "echo" as HookEvent,
        handler: () => {},
      });
    }
    const alepha = Alepha.create().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    expect(() => app.hook.override({ on: "configure" })).toThrow(AlephaError);
    expect(() => app.hook.override({ on: "configure" })).toThrow(
      /Cannot override primitive/,
    );
  });

  it("should support subclass override via constructor", () => {
    class AppRouter {
      hook = $hook({
        on: "echo" as HookEvent,
        handler: () => {},
      });
    }
    class MyAppRouter extends AppRouter {
      constructor() {
        super();
        this.hook.override({ on: "configure" });
      }
    }

    const alepha = Alepha.create().with(MyAppRouter);
    const app = alepha.inject(MyAppRouter);

    expect(app.hook.options.on).toBe("configure");
  });
});
