import { $module, Alepha } from "alepha";
import { $thread } from "./primitives/$thread.ts";
import { ThreadProvider } from "./providers/ThreadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$thread.ts";
export * from "./providers/ThreadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Alepha {
    isWorkerThread(): boolean;
  }
}

Alepha.prototype.isWorkerThread = function (this: Alepha): boolean {
  return !!this.env.ALEPHA_WORKER;
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 1 - experimental | 0.15.0 | node|
 *
 * Multi-threading support.
 *
 * **Features:**
 * - Worker thread definitions
 * - Worker thread management
 * - Message passing
 * - Worker pools
 *
 * @module alepha.thread
 */
export const AlephaThread = $module({
  name: "alepha.thread",
  primitives: [$thread],
  services: [ThreadProvider],
});
