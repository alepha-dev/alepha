import { AiError } from "./AiError.ts";

/**
 * The conversation no longer fits the model's context window. Retrying the
 * same request cannot succeed: the caller has to shorten it.
 */
export const AiContextLengthError = AiError.extend({
  name: "AI_CONTEXT_LENGTH",
  message: "The conversation is too long for the model",
});

export type AiContextLengthError = InstanceType<typeof AiContextLengthError>;
