import { $hook, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { StateManager } from "../providers/StateManager.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Alepha lifecycle", () => {
  describe("stop during an in-flight start", () => {
    it("should not leave the app running after stop() resolves", async () => {
      // `stop()` only checked `started`, which is set near the END of boot().
      // Called while the boot promise was pending it returned immediately,
      // the boot then finished, and the app was left running after the caller
      // had already awaited stop(). Reachable from run()'s SIGTERM trap and
      // from test teardown racing a slow start.
      const alepha = Alepha.create();

      class SlowService {
        started = false;
        onStart = $hook({
          on: "start",
          handler: async () => {
            await sleep(50);
            this.started = true;
          },
        });
      }

      alepha.with(SlowService);

      const starting = alepha.start();
      await sleep(10);

      await alepha.stop();

      await starting.catch(() => undefined);

      expect(alepha.isStarted()).toBe(false);
    });

    it("should run stop hooks for services that did start", async () => {
      const alepha = Alepha.create();
      const events: string[] = [];

      class SlowService {
        onStart = $hook({
          on: "start",
          handler: async () => {
            await sleep(50);
            events.push("start");
          },
        });
        onStop = $hook({
          on: "stop",
          handler: () => {
            events.push("stop");
          },
        });
      }

      alepha.with(SlowService);

      const starting = alepha.start();
      await sleep(10);
      await alepha.stop();
      await starting.catch(() => undefined);

      expect(events).toEqual(["start", "stop"]);
    });
  });

  describe("failed boot", () => {
    it("should stop services that already started", async () => {
      // A start hook throwing after earlier services connected left those
      // services running: resetStartup() cleared `started`, so a later stop()
      // short-circuited and never emitted `stop` — DB connections and
      // listening sockets leaked with no way to close them.
      const alepha = Alepha.create();
      const events: string[] = [];

      class GoodService {
        onStart = $hook({
          on: "start",
          handler: () => {
            events.push("good:start");
          },
        });
        onStop = $hook({
          on: "stop",
          handler: () => {
            events.push("good:stop");
          },
        });
      }

      class FailingService {
        onStart = $hook({
          on: "start",
          after: GoodService,
          handler: () => {
            throw new Error("cannot connect");
          },
        });
      }

      alepha.with(GoodService);
      alepha.with(FailingService);

      // The framework wraps hook failures, so match the cause rather than
      // the exact wrapper message.
      const error = await alepha.start().catch((e) => e);
      expect(String(error?.cause ?? error)).toContain("cannot connect");

      expect(events).toEqual(["good:start", "good:stop"]);
    });
  });

  describe("$mode auto-stop", () => {
    it("should not report ready after a ready hook stopped the app", async () => {
      // `$mode` stops the app from inside the `ready` emit; boot() then
      // carried on and set ready = true anyway, so the container claimed to
      // be ready while being stopped — and a later start() would
      // short-circuit on that flag and report a stopped app as running.
      const alepha = Alepha.create();

      class StopOnReady {
        onReady = $hook({
          on: "ready",
          handler: async () => {
            await alepha.stop();
          },
        });
      }

      alepha.with(StopOnReady);
      await alepha.start();

      expect(alepha.isStarted()).toBe(false);
      expect(alepha.isReady()).toBe(false);
    });
  });

  describe("destroy", () => {
    it("should keep the core providers reachable through inject", async () => {
      // `destroy()` replaced the registry but kept `this.store`/`this.events`,
      // so a later inject(StateManager) built a fresh, EMPTY instance — env
      // and every registered atom silently gone.
      const alepha = Alepha.create();
      await alepha.start();

      await alepha.destroy();

      expect(alepha.inject(StateManager)).toBe(alepha.store);
    });
  });
});
