import { z } from "alepha";

/**
 * The environment the inspector reads.
 */
export const inspectorEnvSchema = z.object({
  /**
   * Turn the inspector on where it is otherwise off: under test, and in a
   * production build made with `alepha build --inspect`. `1` or `true`. `0` or
   * `false` turns it off everywhere, development included.
   */
  ALEPHA_INSPECT: z.text().optional(),

  /**
   * Directory of the run registry, where each inspectable process writes its
   * entry and its socket. Defaults to `~/.alepha/run`. Override it for tests,
   * sandboxes, or a Docker bind mount.
   */
  ALEPHA_RUN_DIR: z.text().optional(),
});
