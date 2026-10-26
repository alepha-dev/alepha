import { z } from "alepha";

import { AiError } from "./AiError.ts";

/**
 * The vendor rate-limited the request (HTTP 429). `retryAfter` is the delay
 * in seconds it asked for, when it said.
 */
export const AiRateLimitError = AiError.extend({
  name: "AI_RATE_LIMIT",
  schema: z.object({
    retryAfter: z.number().optional(),
  }),
  message: "The AI provider rate-limited the request",
});

export type AiRateLimitError = InstanceType<typeof AiRateLimitError>;
