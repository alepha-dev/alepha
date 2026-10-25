import { z } from "alepha";

/**
 * How the devtools opens a file in an editor, the conventions
 * `launch-editor` uses.
 */
export const editorEnvSchema = z.object({
  /**
   * A command called with the file, the line and the column as its three
   * arguments. Wins over `EDITOR`.
   */
  LAUNCH_EDITOR: z.text().optional(),

  /**
   * The editor command (`code`, `cursor`, `zed`, `webstorm`, `subl`...).
   * Without either, `code` is used when it is installed.
   */
  EDITOR: z.text().optional(),
});
