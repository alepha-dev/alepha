import { AiError } from "./AiError.ts";

/**
 * The vendor is overloaded or unavailable (Anthropic's 529, a 503): the
 * request was fine and may succeed later.
 */
export const AiOverloadedError = AiError.extend({
  name: "AI_OVERLOADED",
  message: "The AI provider is overloaded",
});

export type AiOverloadedError = InstanceType<typeof AiOverloadedError>;
