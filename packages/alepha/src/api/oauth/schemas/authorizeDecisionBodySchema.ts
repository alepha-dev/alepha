import { t } from "alepha";

/**
 * Body posted by the consent screen. All authorization-request parameters
 * are round-tripped through hidden form fields so the POST handler can
 * re-validate them without server-side session state.
 */
export const authorizeDecisionBodySchema = t.object({
  decision: t.text(),
  response_type: t.text(),
  client_id: t.text(),
  redirect_uri: t.text({ maxLength: 2048 }),
  code_challenge: t.text(),
  code_challenge_method: t.text(),
  scope: t.optional(t.text({ maxLength: 1024 })),
  state: t.optional(t.text({ maxLength: 512 })),
  resource: t.optional(t.text({ maxLength: 2048 })),
  nonce: t.optional(t.text({ maxLength: 512 })),
});
