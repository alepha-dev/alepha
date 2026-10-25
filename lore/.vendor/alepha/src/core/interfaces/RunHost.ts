import type { Alepha } from "../Alepha.ts";
import type { RunOptions } from "./Run.ts";

/**
 * A process that owns an application's lifecycle instead of `run()`.
 *
 * `run()` normally schedules `configure`, `start` and `ready` on a timer and
 * installs the process signal traps. A host installed on `globalThis` under
 * `Symbol.for("alepha.run.host")` before the entry is imported receives the
 * application and its options instead, and nothing is scheduled: starting,
 * stopping and exiting become the host's job.
 *
 * Internal and opt-in. The one host today is the `@alepha/desktop` Worker,
 * which has to wait until the whole entry wrapper has run (SSR manifest and
 * embedded public files are registered after the import of the app) and then
 * report the bound address to its window. Without a host installed, `run()`
 * behaves exactly as before.
 *
 * ⚠️ Not `ALEPHA_CLI_IMPORT` or `ALEPHA_SERVERLESS`: both change what the
 * application itself does, while a host changes only who drives it.
 */
export interface RunHost {
  /**
   * Take ownership of the application `run()` was given.
   *
   * Called synchronously from `run()`, before anything is scheduled. Throwing
   * here fails the import of the entry, which is how a host refuses options
   * it cannot honour.
   */
  attach(alepha: Alepha, options: RunOptions | undefined): void;
}
