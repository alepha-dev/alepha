import { t } from "alepha";

/**
 * OAuth 2.1 authorization request query parameters (GET /oauth/authorize).
 */
export const authorizeQuerySchema = t.object({
  response_type: t.text(),
  client_id: t.text(),
  redirect_uri: t.text({ maxLength: 2048 }),
  code_challenge: t.text(),
  code_challenge_method: t.text(),
  scope: t.optional(t.text({ maxLength: 1024 })),
  state: t.optional(t.text({ maxLength: 512 })),
  resource: t.optional(t.text({ maxLength: 2048 })),
  prompt: t.optional(t.text({ maxLength: 64 })),
  nonce: t.optional(t.text({ maxLength: 512 })),
});
