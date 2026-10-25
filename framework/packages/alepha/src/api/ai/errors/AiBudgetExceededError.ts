import { z } from "alepha";
import { HttpError } from "alepha/server";

/**
 * The user spent their token budget for the window (`api.ai` parameter).
 * A 429 the chat UI shows as it is: `used` and `limit` are tokens.
 */
export const AiBudgetExceededError = HttpError.extend({
  name: "AI_BUDGET_EXCEEDED",
  schema: z.object({
    used: z.number(),
    limit: z.number(),
  }),
  default: { status: 429 },
  message: (data: { used?: number; limit?: number }) =>
    `AI budget reached: ${data.used ?? "?"} of ${data.limit ?? "?"} tokens used in the current window`,
});

export type AiBudgetExceededError = InstanceType<typeof AiBudgetExceededError>;
