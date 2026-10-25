import { writeFileSync } from "node:fs";

import { $hook, AlephaError } from "alepha";

/**
 * What the desktop e2e observes from outside the binary: a startup failure on
 * demand, and a marker written by the stop hook.
 */
export class FixtureHooks {
  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (process.env.DESKTOP_FIXTURE_FAIL) {
        throw new AlephaError("injected startup failure");
      }
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      if (process.env.DESKTOP_FIXTURE_MARKER) {
        writeFileSync(process.env.DESKTOP_FIXTURE_MARKER, "stopped");
      }
    },
  });
}
