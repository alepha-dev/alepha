import { CommandError } from "./CommandError.ts";

/**
 * A command invoked wrongly: an unknown flag, a missing argument. The CLI
 * prints the message with the command's usage.
 */
export const UsageError = CommandError.extend({
  name: "USAGE",
  message: "Invalid usage",
});

export type UsageError = InstanceType<typeof UsageError>;
