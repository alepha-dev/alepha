import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { AlephaLock } from "../index.ts";
import { $lock } from "../primitives/$lock.ts";
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
});
