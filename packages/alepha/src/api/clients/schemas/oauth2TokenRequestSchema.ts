import { t } from "alepha";

/**
 * Schema for the OAuth2 token endpoint request body.
 * Supports authorization_code, client_credentials, and refresh_token grants.
 */
export const oauth2TokenRequestSchema = t.object({
  grant_type: t.text(),
  code: t.optional(t.text()),
  redirect_uri: t.optional(t.text()),
  client_id: t.optional(t.text()),
  client_secret: t.optional(t.text()),
  code_verifier: t.optional(t.text()),
  resource: t.optional(t.text()),
  scope: t.optional(t.text()),
  refresh_token: t.optional(t.text({ size: "rich" })),
});
