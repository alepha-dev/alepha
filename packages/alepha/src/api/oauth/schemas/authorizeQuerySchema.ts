import { z } from "alepha";

/**
 * OAuth 2.1 authorization request query parameters (GET /oauth/authorize).
 */
export const authorizeQuerySchema = z.object({
  response_type: z.text(),
  client_id: z.text(),
  redirect_uri: z.text({ maxLength: 2048 }),
  code_challenge: z.text(),
  code_challenge_method: z.text(),
  scope: z.text({ maxLength: 1024 }).optional(),
  state: z.text({ maxLength: 512 }).optional(),
  resource: z.text({ maxLength: 2048 }).optional(),
  prompt: z.text({ maxLength: 64 }).optional(),
  nonce: z.text({ maxLength: 512 }).optional(),
});
