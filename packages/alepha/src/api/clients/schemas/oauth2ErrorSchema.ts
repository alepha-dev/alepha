import { t } from "alepha";

/**
 * Standard OAuth2 error response (RFC 6749 Section 5.2).
 */
export const oauth2ErrorSchema = t.object({
  error: t.string(),
  error_description: t.optional(t.string()),
  error_uri: t.optional(t.string()),
});
