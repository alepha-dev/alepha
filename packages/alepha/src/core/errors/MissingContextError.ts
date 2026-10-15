import { $error } from "../primitives/$error.ts";

/**
 * A primitive declared outside a container's context.
 */
export const MissingContextError = $error({
  name: "MISSING_CONTEXT",
  message: "Missing context. Did you forget to call Alepha.create()?",
});

export type MissingContextError = InstanceType<typeof MissingContextError>;
