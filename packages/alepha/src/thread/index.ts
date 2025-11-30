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
 * Simple interface for managing worker threads in Alepha.
 *
 * @see {@link $thread}
 * @module alepha.thread
 */
export const AlephaThread = $module({
  name: "alepha.thread",
  primitives: [$thread],
  services: [ThreadProvider],
});
