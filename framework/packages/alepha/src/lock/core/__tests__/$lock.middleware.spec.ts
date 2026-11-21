import { $pipeline, Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { LockAcquireError } from "../errors/LockAcquireError.ts";
import { AlephaLock } from "../index.ts";
import { $lock } from "../primitives/$lock.ts";
import { LockProvider } from "../providers/LockProvider.ts";

describe("$lock middleware", () => {
  it("executes handler when lock is available", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLock);

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: "test-lock" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn()).toBe("ok");

    await alepha.stop();
  });

  it("passes handler arguments through", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLock);

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: "test-args-lock" })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn(3, 4)).toBe(7);

    await alepha.stop();
  });

  it("supports dynamic lock names", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLock);

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: (id: string) => `resource:${id}` })],
        handler: async (id: string) => `processed:${id}`,
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn("abc")).toBe("processed:abc");

    await alepha.stop();
  });

  it("throws LockAcquireError when lock is held (wait=false)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLock);

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: "held-lock" })],
        handler: async () => "should-not-run",
      });
    }

    const lockProvider = alepha.inject(LockProvider);
    const svc = alepha.inject(TestService);
    await alepha.start();

    // Pre-acquire the lock
    await lockProvider.set(
      "held-lock",
      "other-id,2026-01-01T00:00:00Z",
      true,
      60000,
    );

    await expect(svc.fn()).rejects.toThrow(LockAcquireError);

    await alepha.stop();
  });

  it("releases the lock when a lock:acquired listener throws", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLock);
    const released: string[] = [];
    let ran = 0;

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: "listener-throws-lock" })],
        handler: async () => {
          ran++;
        },
      });
    }

    const lockProvider = alepha.inject(LockProvider);
    const svc = alepha.inject(TestService);
    alepha.events.on("lock:acquired", () => {
      throw new AlephaError("listener failed");
    });
    alepha.events.on("lock:released", ({ name }) => {
      released.push(name);
    });
    await alepha.start();

    await expect(svc.fn()).rejects.toThrow("listener failed");

    expect(ran).toBe(0);
    expect(await lockProvider.get("listener-throws-lock")).toBeUndefined();
    expect(released).toEqual(["listener-throws-lock"]);

    await alepha.stop();
  });

  it("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLock);

    class TestService {
      fn = $pipeline({
        use: [$lock({ name: "meta-lock" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$lock");
  });
});
