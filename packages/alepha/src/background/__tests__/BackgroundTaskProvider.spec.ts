import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { BackgroundTaskProvider } from "../providers/BackgroundTaskProvider.ts";
import { WorkerdBackgroundTaskProvider } from "../providers/WorkerdBackgroundTaskProvider.ts";

describe("BackgroundTaskProvider", () => {
  it("runs a deferred task off the caller's stack and resolves on flush", async () => {
    const alepha = Alepha.create();
    const background = alepha.inject(BackgroundTaskProvider);
    await alepha.start();

    let ran = false;
    background.defer(async () => {
      ran = true;
    });

    // Detached onto a microtask — not run synchronously when defer() returns.
    expect(ran).toBe(false);

    await background.flush();
    expect(ran).toBe(true);
  });

  it("does not block the caller and swallows + flush-resolves on task error", async () => {
    const alepha = Alepha.create();
    const background = alepha.inject(BackgroundTaskProvider);
    await alepha.start();

    // A throwing task must neither escape defer() nor reject flush().
    expect(() =>
      background.defer(() => {
        throw new Error("boom");
      }),
    ).not.toThrow();

    await expect(background.flush()).resolves.toBeUndefined();
  });

  it("awaits in-flight tasks on stop", async () => {
    const alepha = Alepha.create();
    const background = alepha.inject(BackgroundTaskProvider);
    await alepha.start();

    let done = false;
    background.defer(async () => {
      await Promise.resolve();
      done = true;
    });

    await alepha.stop();
    expect(done).toBe(true);
  });

  describe("WorkerdBackgroundTaskProvider", () => {
    it("wraps the deferred task in the request's waitUntil", async () => {
      const alepha = Alepha.create();
      alepha.with({
        provide: BackgroundTaskProvider,
        use: WorkerdBackgroundTaskProvider,
      });
      const captured: Promise<unknown>[] = [];
      alepha.set("cloudflare.waitUntil", (p: Promise<unknown>) => {
        captured.push(p);
      });
      const background = alepha.inject(BackgroundTaskProvider);
      await alepha.start();

      background.defer(async () => {});

      expect(captured).toHaveLength(1);
      expect(captured[0]).toBeInstanceOf(Promise);
      await background.flush();
    });

    it("falls back to fire-and-track when no waitUntil is in scope", async () => {
      const alepha = Alepha.create();
      alepha.with({
        provide: BackgroundTaskProvider,
        use: WorkerdBackgroundTaskProvider,
      });
      const background = alepha.inject(BackgroundTaskProvider);
      await alepha.start();

      let ran = false;
      // No `cloudflare.waitUntil` set — must still run, not throw.
      expect(() =>
        background.defer(async () => {
          ran = true;
        }),
      ).not.toThrow();

      await background.flush();
      expect(ran).toBe(true);
    });
  });
});
