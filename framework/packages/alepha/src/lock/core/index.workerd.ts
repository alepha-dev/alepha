import { $module } from "alepha";

import { LockProvider } from "./providers/LockProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/LockAcquireError.ts";
export * from "./primitives/$lock.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/MemoryLockProvider.ts";

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
     * Fires when a lock is released: the handler completed or threw, or a
     * `lock:acquired` listener threw.
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
 * The workerd half of `alepha.lock`: memory only.
 *
 * ⚠️ It never imports `RedisLockProvider`: no Redis
 * client runs in a Worker, and `alepha/scheduler`'s workerd barrel imports
 * this module. Keep its exports in step with `index.ts` by hand, minus the
 * Redis provider.
 */
export const AlephaLock = $module({
  name: "alepha.lock",
  services: [LockProvider],
  variants: [MemoryLockProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: LockProvider,
      use: MemoryLockProvider,
    }),
});
