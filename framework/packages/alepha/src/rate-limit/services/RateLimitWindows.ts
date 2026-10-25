import { AlephaError } from "alepha";
import { $actor } from "alepha/actor";

import { rateLimitWindow } from "../rateLimitWindow.ts";

/**
 * The one fixed-window actor every `$rateLimit` counts through, keyed
 * `<name>:<key>`, and the registry of limiter names.
 *
 * `ActorRegistry` refuses a second declaration under one atom name, so the
 * declaration has exactly one owner. It registers when this service is
 * injected, not at start: a Durable Object resolves it without starting the app.
 */
export class RateLimitWindows {
  protected readonly names = new Set<string>();

  public readonly window = $actor({
    atom: rateLimitWindow,
    methods: {
      /**
       * Count one hit. A window opens on its first hit; past the limit the
       * count saturates at `limit + 1` and later refusals change nothing, so
       * they commit nothing.
       */
      hit: (state, now: number, windowMs: number, limit: number) => {
        if (state.resetAt <= now) return { count: 1, resetAt: now + windowMs };
        if (state.count > limit) return state;
        return { count: state.count + 1, resetAt: state.resetAt };
      },
      /**
       * Give one counted hit back, in the window it was counted in only. The
       * clamp keeps a refund after saturation from landing on the marker.
       */
      refund: (state, resetAt: number, limit: number) => {
        if (state.resetAt !== resetAt || state.count <= 0) return state;
        return {
          count: Math.min(state.count, limit) - 1,
          resetAt: state.resetAt,
        };
      },
    },
    expiresAt: (state) => state.resetAt,
  });

  public register(name: string): void {
    if (this.names.has(name))
      throw new AlephaError(`Duplicate rate limiter '${name}'`);
    this.names.add(name);
  }
}
