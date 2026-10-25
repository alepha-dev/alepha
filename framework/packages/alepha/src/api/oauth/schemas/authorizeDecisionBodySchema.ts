import { z } from "alepha";

/**
 * Body posted by the consent screen. All authorization-request parameters
 * are round-tripped through hidden form fields so the POST handler can
 * re-validate them without server-side session state.
 */
export const authorizeDecisionBodySchema = z.object({
  decision: z.text(),
  response_type: z.text(),
  client_id: z.text(),
  redirect_uri: z.text({ maxLength: 2048 }),
  code_challenge: z.text(),
  code_challenge_method: z.text(),
  scope: z.text({ maxLength: 1024 }).optional(),
  state: z.text({ maxLength: 512 }).optional(),
  resource: z.text({ maxLength: 2048 }).optional(),
  nonce: z.text({ maxLength: 512 }).optional(),
});
