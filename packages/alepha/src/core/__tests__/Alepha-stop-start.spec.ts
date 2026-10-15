import { $hook, Alepha, AlephaError, MissingContextError } from "alepha";
import { describe, expect, it } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The same container with short budgets, so a spec can outlast them.
 */
class QuickAlepha extends Alepha {
  protected static override readonly STOP_TIMEOUT = 100;
  protected static override readonly STARTUP_TIMEOUT = 50;
}

describe("Alepha#stop", () => {
  it("runs every stop hook when one throws, clears started and ready, then rejects naming the failure", async () => {
    const alepha = Alepha.create();
    const stopped: string[] = [];

    class Broken {
      onStop = $hook({
        on: "stop",
        handler: () => {
          stopped.push("broken");
          throw new Error("socket already closed");
        },
      });
    }
    class Database {
      onStop = $hook({
        on: "stop",
        handler: () => {
          stopped.push("database");
        },
      });
    }

    alepha.with(Broken).with(Database);
    await alepha.start();

    const error = await alepha.stop().then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(stopped).toEqual(["broken", "database"]);
    expect(alepha.isStarted()).toBe(false);
    expect(alepha.isReady()).toBe(false);
    expect(error).toBeInstanceOf(AlephaError);
    expect((error as Error).message).toContain("Broken");
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("gives up after STOP_TIMEOUT, names the pending hooks and still clears the state", async () => {
    const alepha = new QuickAlepha();
    let release: () => void = () => {};

    class Flusher {
      onStop = $hook({
        on: "stop",
        handler: () => new Promise<void>((resolve) => (release = resolve)),
      });
    }

    alepha.with(Flusher);
    await alepha.start();

    const before = performance.now();
    await expect(alepha.stop()).rejects.toThrow(/Flusher/);
    expect(performance.now() - before).toBeLessThan(2_000);
    expect(alepha.isStarted()).toBe(false);
    release();
  });
});

describe("Alepha#start", () => {
  it("joins a slow boot in flight outside serverless, past STARTUP_TIMEOUT", async () => {
    const alepha = new QuickAlepha();
    let starts = 0;

    class Slow {
      onStart = $hook({
        on: "start",
        handler: async () => {
          starts += 1;
          await sleep(150);
        },
      });
    }

    alepha.with(Slow);
    const first = alepha.start();
    await sleep(80);
    const second = alepha.start();
    await Promise.all([first, second]);

    expect(starts).toBe(1);
    expect(alepha.isReady()).toBe(true);
  });

  it("does not let a boot that was reset emit start or set ready when it resumes", async () => {
    const alepha = new QuickAlepha({ env: { ALEPHA_SERVERLESS: true } });
    const events: string[] = [];
    let call = 0;

    class Slow {
      onConfigure = $hook({
        on: "configure",
        handler: async () => {
          call += 1;
          // The first boot is the frozen invocation: it resumes only after
          // the second one has finished.
          if (call === 1) await sleep(150);
        },
      });
      onStart = $hook({
        on: "start",
        handler: () => {
          events.push("start");
        },
      });
    }

    alepha.with(Slow);
    const stale = alepha.start();
    await sleep(80);
    await alepha.start();
    await stale;

    expect(events).toEqual(["start"]);
    expect(alepha.isReady()).toBe(true);
  });
});

describe("core exports", () => {
  it("exports MissingContextError", () => {
    expect(new MissingContextError()).toBeInstanceOf(Error);
  });

  it("detects Cloudflare through globalThis", () => {
    const alepha = Alepha.create();
    const scope = globalThis as { Cloudflare?: unknown };
    scope.Cloudflare = {};
    try {
      expect(alepha.isServerless()).toBe(true);
    } finally {
      delete scope.Cloudflare;
    }
  });
});
