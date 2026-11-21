import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaLock, LockProvider, MemoryLockProvider } from "alepha/lock";
import { describe, expect, it } from "vitest";

import {
  SharedLockProvider,
  testDelIfOwner,
  testLockBasic,
  testLockWait,
} from "./shared.ts";

describe("MemoryLockProvider", () => {
  const Provider = SharedLockProvider;

  it("should lock without waiting", async () => {
    await testLockBasic(Provider);
  });

  it("should let one caller at a time in when waiting", async () => {
    await testLockWait(Provider);
  });

  it("delIfOwner only deletes the caller's own lock", async () => {
    await testDelIfOwner(Provider);
  });

  it("delIfOwner does not yield between the compare and the delete", async () => {
    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: MemoryLockProvider })
      .with(AlephaLock);
    const lock = alepha.inject(LockProvider);
    await alepha.start();

    const key = `del-if-owner-yield-${randomUUID()}`;
    await lock.set(key, `owner-1,${new Date().toISOString()}`, true, 30_000);

    // The inherited release awaits between reading the value and deleting it.
    // A takeover queued right behind it lands in that gap, and the delete then
    // removes owner-2's lock instead of owner-1's. Nothing here is I/O, so the
    // memory provider does both in one synchronous section and the takeover
    // survives.
    const release = lock.delIfOwner(key, "owner-1");
    const takeover = lock.set(
      key,
      `owner-2,${new Date().toISOString()}`,
      true,
      30_000,
    );

    await Promise.all([release, takeover]);

    expect(await lock.get(key)).toContain("owner-2");
  });
});
