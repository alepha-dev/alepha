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
  /**
   * What the supervisor is spending on this app right now.
   *
   * Declared here and not only on the TypeScript interface: the response
   * schema is what gets serialized, so a field it does not name is dropped on
   * the way out. The type said `usage` existed, the client type said it
   * existed, and the browser received nothing — with no error anywhere.
   *
   * Optional throughout, because bay-go reports nothing rather than zero when
   * it does not know. A zero would read as a measurement.
   */
  /**
   * When this app last answered a request, RFC3339. Absent means never.
   *
   * Declared here for the same reason `usage` is: the response schema is what
   * serializes, so a field it does not name is dropped on the way out with no
   * error anywhere — the browser simply receives nothing.
   */
  lastRequestAt: z.text().optional(),
  /**
   * How many crons the deployed artifact declared. Absent on an older bay-go,
   * which must read as "unknown" rather than "none": telling someone an app has
   * no scheduled work when it has three is how a working app gets deleted.
   */
  crons: z.integer().optional(),
  usage: z
    .object({
      memoryBytes: z.integer().optional(),
      cpuSeconds: z.number().optional(),
      tasks: z.integer().optional(),
      restarts: z.integer(),
      startedAt: z.text().optional(),
      pid: z.integer().optional(),
    })
    .optional(),
});
