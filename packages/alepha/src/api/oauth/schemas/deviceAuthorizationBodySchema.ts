import { z } from "alepha";

/**
 * Body of a POST /oauth/device_authorization request (RFC 8628 §3.1).
 *
 * Every field is optional at the schema level, matching the sibling token
 * request: the handler applies the defaults, and a malformed request must get an
 * OAuth error rather than a schema rejection the client cannot interpret.
 */
export const deviceAuthorizationBodySchema = z.object({
  client_id: z.text({ maxLength: 256 }).optional(),
  scope: z.text({ maxLength: 1024 }).optional(),
  resource: z.text({ maxLength: 2048 }).optional(),
});
