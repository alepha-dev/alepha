import { $module } from "alepha";
import { RedisActivation } from "alepha/redis";
import { MemoryTopicProvider, RedisTopicProvider } from "alepha/topic";

import { LockProvider } from "./providers/LockProvider.ts";
import { LockTopicProvider } from "./providers/LockTopicProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";
import { RedisLockProvider } from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/LockAcquireError.ts";
export * from "./primitives/$lock.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/LockTopicProvider.ts";
export * from "./providers/MemoryLockProvider.ts";
export * from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Fires when a lock is successfully acquired.
     */
    "lock:acquired": {
      name: string;
      id: string;
      maxDurationMs: number;
    };
    /**
     * Fires when a lock is released (handler completed or threw).
     */
    "lock:released": {
      name: string;
      id: string;
      heldMs: number;
    };
    /**
     * Fires when a lock acquisition contends with another holder.
     * Emitted whether the caller eventually acquires (`wait: true`) or fails.
     */
    "lock:contended": {
      name: string;
      id: string;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Resource locking for distributed systems.
 *
 * **Features:**
 * - Distributed locks with timeout
 * - Time-based lock expiration
 * - Automatic release on scope exit
 * - Distributed coordination via Redis
 * - Providers: Redis when `REDIS_URL` is set, Memory otherwise
 *
 * Set `REDIS_URL` and a lock held on one instance is held for all of them:
 * each `$job` cron tick runs on one instance. Leave it unset and locks only
 * exclude callers inside this process. An app's own `LockProvider` or
 * `LockTopicProvider` substitution wins over both.
 *
 * @module alepha.lock
 */
export const AlephaLock = $module({
  name: "alepha.lock",
  services: [LockProvider, LockTopicProvider],
  variants: [MemoryLockProvider, RedisLockProvider],
  register: (alepha) => {
    const redis = alepha.inject(RedisActivation).isActive();
    alepha
      .with({
        optional: true,
        provide: LockTopicProvider,
        use: redis ? RedisTopicProvider : MemoryTopicProvider,
      })
      .with({
        optional: true,
        provide: LockProvider,
        use: redis ? RedisLockProvider : MemoryLockProvider,
      });
  },
});
