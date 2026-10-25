import { UsageError } from "./UsageError.ts";

/**
 * A prompt that needs an answer where no terminal can give one.
 */
export const NoInputError = UsageError.extend({
  name: "NO_INPUT",
  message: "No input available",
});

export type NoInputError = InstanceType<typeof NoInputError>;
