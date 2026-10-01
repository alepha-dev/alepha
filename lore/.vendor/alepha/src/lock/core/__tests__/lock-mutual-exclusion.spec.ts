import { Alepha, createPrimitive } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaLock } from "../index.ts";
import { $lock, LockPrimitive } from "../primitives/$lock.ts";
import { LockProvider } from "../providers/LockProvider.ts";
import { MemoryLockProvider } from "../providers/MemoryLockProvider.ts";

describe("$lock middleware — same-process mutual exclusion", () => {
  it("lets only one of several concurrent calls enter the critical section", async () => {
    let inside = 0;
    let maxConcurrent = 0;

    class Svc {
      guard = $lock({ name: "critical" });
      critical = this.guard(async () => {
        inside++;
        maxConcurrent = Math.max(maxConcurrent, inside);
        await new Promise((r) => setTimeout(r, 30));
        inside--;
        return true;
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: MemoryLockProvider })
      .with(AlephaLock);
    const svc = alepha.inject(Svc);
    await alepha.start();

    const results = await Promise.allSettled([
      svc.critical(),
      svc.critical(),
      svc.critical(),
    ]);

    // Regression: previously the lock id was created once at composition time and
    // shared by all invocations, so all three entered at once (maxConcurrent=3).
    expect(maxConcurrent).toBe(1);

    // Exactly one caller acquires; the others are rejected (no `wait` option).
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });

  it("a finisher whose lock expired must not release the next holder's lock", async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    class Svc {
      guard = $lock({
        name: "expiry-release",
        maxDuration: [400, "millisecond"],
      });
      critical = this.guard(async (ms: number) => {
        await sleep(ms);
        return true;
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: MemoryLockProvider })
      .with(AlephaLock);
    const svc = alepha.inject(Svc);
    await alepha.start();

    // A holds the lock but outlives maxDuration (400ms) — its lock expires
    // at t=400 while it keeps running until t=700.
    const a = svc.critical(700);
    await sleep(500);

    // t=500: A's lock has expired; B legitimately acquires a fresh one,
    // valid until t=900.
    const b = svc.critical(600);
    await sleep(300);

    // t=800: A finished at t=700 and "released". B is still running and its
    // lock is valid until t=900 — C must be refused.
    const c = svc.critical(10);

    const results = await Promise.allSettled([a, b, c]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("rejected");
  });
});

describe("LockPrimitive — same-instance mutual exclusion", () => {
  it("overlapping run() calls on one primitive do not both enter", async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let inside = 0;
    let maxConcurrent = 0;
    let calls = 0;

    class Svc {
      work = createPrimitive(LockPrimitive, {
        handler: async () => {
          calls++;
          inside++;
          maxConcurrent = Math.max(maxConcurrent, inside);
          await sleep(50);
          inside--;
        },
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: MemoryLockProvider })
      .with(AlephaLock);
    const svc = alepha.inject(Svc);
    await alepha.start();

    // A single primitive instance sharing one lock id would hand every
    // overlapping call the same identity — all of them would "own" the lock.
    await Promise.all([svc.work.run(), svc.work.run(), svc.work.run()]);

    expect(maxConcurrent).toBe(1);
    expect(calls).toBe(1);
  });
});
