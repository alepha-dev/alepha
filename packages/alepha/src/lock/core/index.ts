import { $module } from "alepha";
import { MemoryTopicProvider } from "alepha/topic";
import { $lock } from "./primitives/$lock.ts";
import { LockProvider } from "./providers/LockProvider.ts";
import { LockTopicProvider } from "./providers/LockTopicProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$lock.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/LockTopicProvider.ts";
export * from "./providers/MemoryLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.8.0 | node, bun, workerd|
 *
 * Resource locking for distributed systems.
 *
 * **Features:**
 * - Distributed locks with timeout
 * - Time-based lock expiration
 * - Automatic release on scope exit
 * - Distributed coordination via Redis
 * - Providers: Memory (dev), Redis (production)
 *
 * @module alepha.lock
 */
export const AlephaLock = $module({
  name: "alepha.lock",
  primitives: [$lock],
  services: [LockProvider, MemoryLockProvider, LockTopicProvider],
  register: (alepha) =>
    alepha
      .with({
        optional: true,
        provide: LockTopicProvider,
        use: MemoryTopicProvider,
      })
      .with({
        optional: true,
        provide: LockProvider,
        use: MemoryLockProvider,
      }),
});
