import { z } from "alepha";

/**
 * One app instance as bay-go's control API reports it.
 */
export const bayAppSchema = z.object({
  name: z.text(),
  env: z.text(),
  domain: z.text(),
  release: z.text(),
  port: z.integer(),
  runtime: z.text(),
  /**
   * Whether the app is answering right now.
   *
   * Optional because an older bay-go does not report it, and a missing value
   * must not read as "stopped" — the list would then accuse healthy apps of
   * being down on the strength of the binary's age.
   */
  running: z.boolean().optional(),
});
