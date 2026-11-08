import { $pipeline, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryTraceProvider, Tracer } from "alepha/tracing";
import { describe, it } from "vitest";

import { LockAcquireError } from "../errors/LockAcquireError.ts";
import { AlephaLock } from "../index.ts";
import { $lock } from "../primitives/$lock.ts";

/**
 * The `lock acquire` span (#E86): it ends once the lock is held or refused,
 * never covers the held section, and names the lock only when the name is
 * static.
 */
describe("$lock tracing", () => {
  const boot = async <T extends object>(Service: new () => T) => {
    const alepha = Alepha.create().with(AlephaLock);
    const svc = alepha.inject(Service);
    const traces = alepha.inject(MemoryTraceProvider);
    const tracer = alepha.inject(Tracer);
    await alepha.start();
    const inTrace = <R>(name: string, fn: () => Promise<R>) =>
      alepha.context.run(() => tracer.startRoot(name, {}, fn));
    return { alepha, svc, traces, inTrace };
  };

  it("spans the acquire only, with the static name, uncontended", async ({
    expect,
  }) => {
    class Service {
      fn = $pipeline({
        use: [$lock({ name: "orders" })],
        handler: async () => "ok",
      });
    }
    const { svc, traces, inTrace } = await boot(Service);

    await inTrace("test", () => svc.fn());

    const [acquire] = traces.children(traces.find("test")!);
    expect(acquire.name).toBe("lock acquire");
    expect(acquire.attributes).toMatchObject({
      "lock.name": "orders",
      "lock.contended": false,
    });
    expect(acquire.attributes["lock.wait_ms"]).toBeTypeOf("number");
    expect(acquire.status).toBe("unset");
  });

  it("never records a computed name, and ends failed on LockAcquireError", async ({
    expect,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    class Service {
      fn = $pipeline({
        use: [$lock({ name: (id: string) => `order:${id}` })],
        handler: async (_id: string) => {
          await held;
        },
      });
    }
    const { svc, traces, inTrace } = await boot(Service);

    const first = inTrace("first", () => svc.fn("secret-42"));
    await new Promise((r) => setTimeout(r, 5));
    await expect(inTrace("second", () => svc.fn("secret-42"))).rejects.toThrow(
      LockAcquireError,
    );
    release();
    await first;

    const [refused] = traces.children(traces.find("second")!);
    expect(refused.name).toBe("lock acquire");
    expect(refused.attributes["lock.name"]).toBeUndefined();
    expect(refused.attributes["lock.contended"]).toBe(true);
    expect(refused.status).toBe("error");
    expect(refused.exception?.type).toBe(
      new LockAcquireError({ lock: "x" }).name,
    );
    const values = traces
      .spans()
      .flatMap((s) => Object.values(s.attributes).map(String))
      .join(" ");
    expect(values).not.toContain("secret-42");
  });

  it("measures the wait of a contended acquire on the injectable clock", async ({
    expect,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    class Service {
      fn = $pipeline({
        use: [$lock({ name: "queue", wait: true })],
        handler: async () => {
          await held;
        },
      });
    }
    const { alepha, svc, traces, inTrace } = await boot(Service);
    const time = alepha.inject(DateTimeProvider);
    time.pause();

    const first = inTrace("first", () => svc.fn());
    await new Promise((r) => setTimeout(r, 5));
    const second = inTrace("second", () => svc.fn());
    await new Promise((r) => setTimeout(r, 5));
    release();
    await first;
    await time.travel([500, "milliseconds"]);
    await second;

    const [acquire] = traces.children(traces.find("second")!);
    expect(acquire.attributes["lock.contended"]).toBe(true);
    expect(acquire.attributes["lock.wait_ms"]).toBeGreaterThanOrEqual(500);
  });
});
