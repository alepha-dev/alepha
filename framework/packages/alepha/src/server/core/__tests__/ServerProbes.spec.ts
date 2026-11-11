import { $hook, Alepha } from "alepha";
import {
  AlephaServer,
  ServerNotReadyProvider,
  ServerProvider,
} from "alepha/server";
import { describe, expect, it } from "vitest";

/**
 * A promise the spec resolves by hand, to hold a lifecycle hook open.
 */
const gate = () => {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
};

/**
 * Fetch until the listener answers at all, since the spec starts the app
 * without awaiting it.
 */
const firstAnswer = async (url: () => string): Promise<Response> => {
  for (let i = 0; i < 200; i++) {
    try {
      return await fetch(url());
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw new Error(`${url()} never answered`);
};

/**
 * `/livez` and `/readyz` (#Q3348), with `ServerNotReadyProvider` registered
 * by hand: it is left out under test (`server/core/index.ts`), and a spec
 * without it would prove nothing about the 503s it answers.
 */
describe("liveness and readiness probes", () => {
  it("answers /livez while a start hook still runs, when /readyz and /health answer 503", async () => {
    const starting = gate();

    class SlowMigrations {
      public readonly start = $hook({
        on: "start",
        handler: () => starting.closed,
      });
    }

    // ⚠️ Registered BEFORE the server: hooks of one priority run in
    // registration order, so this is the case where only the listener's
    // explicit `priority: "first"` lets `/livez` answer during the hook.
    const alepha = Alepha.create()
      .with(SlowMigrations)
      .with(AlephaServer)
      .with(ServerNotReadyProvider);
    const server = alepha.inject(ServerProvider);
    const started = alepha.start();

    try {
      const live = await firstAnswer(() => `${server.hostname}/livez`);
      expect(live.status).toBe(200);
      expect((await live.json()).ready).toBe(false);

      expect((await fetch(`${server.hostname}/readyz`)).status).toBe(503);
      expect((await fetch(`${server.hostname}/health`)).status).toBe(503);
      expect((await fetch(`${server.hostname}/healthz`)).status).toBe(503);

      starting.open();
      await started;

      expect((await fetch(`${server.hostname}/readyz`)).status).toBe(200);
      expect((await fetch(`${server.hostname}/livez`)).status).toBe(200);
    } finally {
      starting.open();
      await started.catch(() => undefined);
      await alepha.stop();
    }
  });

  it("answers /readyz 503 from the moment stop() begins, while /livez still answers", async () => {
    const stopping = gate();
    let stopReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      stopReached = resolve;
    });

    class SlowDrain {
      // First, so the listener's own stop hook has not run yet: the
      // connection the probe uses is still served.
      public readonly stop = $hook({
        on: "stop",
        priority: "first",
        handler: async () => {
          stopReached();
          await stopping.closed;
        },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(ServerNotReadyProvider)
      .with(SlowDrain);
    const server = alepha.inject(ServerProvider);
    await alepha.start();
    const base = server.hostname;

    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect(alepha.isStopping()).toBe(false);

    const stopped = alepha.stop();
    try {
      await reached;
      expect(alepha.isStopping()).toBe(true);
      // Still "ready" by the old signal, which is why `/readyz` reads the
      // stopping state instead.
      expect(alepha.isReady()).toBe(true);

      const ready = await fetch(`${base}/readyz`);
      expect(ready.status).toBe(503);
      expect((await fetch(`${base}/livez`)).status).toBe(200);
    } finally {
      stopping.open();
      await stopped;
    }
    expect(alepha.isStopping()).toBe(false);
  });
});
