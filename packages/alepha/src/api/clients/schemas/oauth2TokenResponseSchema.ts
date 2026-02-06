import { t } from "alepha";

/**
 * Standard OAuth2 token response.
 */
export const oauth2TokenResponseSchema = t.object({
  access_token: t.string(),
  token_type: t.string(),
  expires_in: t.optional(t.number()),
  refresh_token: t.optional(t.string()),
  scope: t.optional(t.string()),
});
