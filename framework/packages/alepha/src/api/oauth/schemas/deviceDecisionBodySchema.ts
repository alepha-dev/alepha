import { z } from "alepha";

/**
 * Body posted by the device approval page's Allow and Deny buttons.
 */
export const deviceDecisionBodySchema = z.object({
  user_code: z.text({ maxLength: 64 }),
  decision: z.enum(["allow", "deny"]),
});
