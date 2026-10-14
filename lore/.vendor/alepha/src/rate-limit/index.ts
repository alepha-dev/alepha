import { $module } from "alepha";
import { AlephaActor } from "alepha/actor";

import { $rateLimit } from "./primitives/$rateLimit.ts";
import { RateLimitWindows } from "./services/RateLimitWindows.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/RateLimitInterfaces.ts";
export * from "./primitives/$rateLimit.ts";
export * from "./rateLimitWindow.ts";
export * from "./services/RateLimitWindows.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * A `$rateLimit` refused a consume: by its limit, or by a store error or
     * contention under `deny`. Never emitted for a counted hit.
     */
    "rate-limit:consume:denied": {
      name: string;
      key: string;
      reason: "limit" | "store" | "contention";
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Transport-agnostic, fail-closed rate limiting on `$actor`.
 *
 * **Features:**
 * - `$rateLimit` limiters with `consume` and `refund(ticket)`
 * - Fixed windows anchored on the first hit, saturating without writes
 * - `deny` on store errors and contention by default
 * - Topology from the actor provider: Memory (one instance), Redis (several),
 *   Durable Objects (workerd)
 *
 * @module alepha.rate-limit
 */
export const AlephaRateLimit = $module({
  name: "alepha.rate-limit",
  imports: [AlephaActor],
  primitives: [$rateLimit],
  services: [RateLimitWindows],
});
