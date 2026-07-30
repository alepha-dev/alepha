import { z } from "alepha";

/**
 * Body of a POST /oauth/token request. OAuth 2.1 mandates
 * application/x-www-form-urlencoded encoding (section 3.2.2). All fields are
 * optional at the schema level; the handler enforces the grant-specific
 * requirements and returns the appropriate OAuth error responses.
 */
export const tokenRequestBodySchema = z.object({
  grant_type: z.text().optional(),
  code: z.text({ maxLength: 4096 }).optional(),
  client_id: z.text().optional(),
  redirect_uri: z.text({ maxLength: 2048 }).optional(),
  code_verifier: z.text({ maxLength: 256 }).optional(),
  refresh_token: z.text({ maxLength: 4096 }).optional(),
  client_secret: z.text({ maxLength: 512 }).optional(),
  /** RFC 8628: presented by a device polling for its grant. */
  device_code: z.text({ maxLength: 512 }).optional(),
});
