import { $env, $hook, $inject, Alepha, ContainerLockedError, z } from "alepha";
import { describe, it } from "vitest";

describe("Alepha#start", () => {
  /**
   * Start the application.
   *
   * Start act like a lock, it will prevent any further registration.
   */
  it("should lock container after start", async ({ expect }) => {
    class A {
      a = "a";
      e = $env(
        z.object({
          HELLO: z.text(),
        }),
      );
    }

    const app = await Alepha.create({ env: { HELLO: "WORLD", MISSING: "123" } })
      .with(A)
      .start();

    // you can't register after start.
    expect(() => app.with(class {})).toThrow(ContainerLockedError);

    // you can't get after start.
    expect(() => app.inject(class {})).toThrow(ContainerLockedError);
  });

  /**
   * B -> A so:
   *
   * - B should be configured after A.
   * - B should be started after A.
   * - A should be stopped before B (registration order).
   *
   * To control stop order, use `priority: "first"` on hooks.
   */
  it("should execute hooks in correct order", async ({ expect }) => {
    const stack: string[] = [];

    class A {
      onConfigure = $hook({
        on: "configure",
        handler: async () => {
          stack.push("A.configure");
        },
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("A.start");
        },
      });

      onStop = $hook({
        on: "stop",
        handler: async () => {
          stack.push("A.stop");
        },
      });
    }

    class B {
      a = $inject(A);

      onConfigure = $hook({
        on: "configure",
        handler: async () => {
          stack.push("B.configure");
        },
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          stack.push("B.start");
        },
      });

      onStop = $hook({
        on: "stop",
        handler: async () => {
          stack.push("B.stop");
        },
      });
    }

    const app = await Alepha.create().with(B).start();

    await app.start();
    await app.start();

    expect(stack).toEqual(["A.configure", "B.configure", "A.start", "B.start"]);

    await app.stop();

    expect(stack).toEqual([
      "A.configure",
      "B.configure",
      "A.start",
      "B.start",
      "A.stop",
      "B.stop",
    ]);

    await app.stop();

    expect(stack).toEqual([
      "A.configure",
      "B.configure",
      "A.start",
      "B.start",
      "A.stop",
      "B.stop",
    ]);
  });

  it("should support restart lifecycle", async ({ expect }) => {
    let count = 0;

    const alepha = Alepha.create().with(
      class App {
        configure = $hook({
          on: "configure",
          handler: () => {
            count += 10;
          },
        });

        start = $hook({
          on: "start",
          handler: () => {
            count += 100;
          },
        });

        stop = $hook({
          on: "stop",
          handler: () => {
            count += 1000;
          },
        });
      },
    );

    expect(alepha.isConfigured()).toBe(false);
    expect(alepha.isLocked()).toBe(false);
    expect(alepha.isStarted()).toBe(false);
    expect(count).toBe(0);

    await alepha.start();

    expect(alepha.isConfigured()).toBe(true);
    expect(alepha.isLocked()).toBe(true);
    expect(alepha.isStarted()).toBe(true);
    expect(count).toBe(110);

    await alepha.stop();

    expect(alepha.isConfigured()).toBe(true);
    expect(alepha.isLocked()).toBe(true);
    expect(alepha.isStarted()).toBe(false);
    expect(count).toBe(1110);
  });
});
