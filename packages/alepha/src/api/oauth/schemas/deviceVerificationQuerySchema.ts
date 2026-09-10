import { z } from "alepha";

/**
 * Query of GET /oauth/device, the device-flow approval page.
 *
 * `user_code` is optional: RFC 8628 §3.2 hands a device both the bare
 * `verification_uri`, where the human types the code, and
 * `verification_uri_complete`, which carries it.
 */
export const deviceVerificationQuerySchema = z.object({
  user_code: z.text({ maxLength: 64 }).optional(),
});
