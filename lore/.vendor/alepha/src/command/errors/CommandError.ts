import { $error, z } from "alepha";

/**
 * A command that failed: the CLI prints its message and exits with
 * `data.exitCode` (1 when unset).
 */
export const CommandError = $error({
  name: "COMMAND",
  schema: z.object({ exitCode: z.integer().optional() }),
  message: "Command failed",
});

export type CommandError = InstanceType<typeof CommandError>;
