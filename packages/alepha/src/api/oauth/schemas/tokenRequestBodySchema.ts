import { t } from "alepha";

/**
 * Body of a POST /oauth/token request. OAuth 2.1 mandates
 * application/x-www-form-urlencoded encoding (section 3.2.2). All fields are
 * optional at the schema level; the handler enforces the grant-specific
 * requirements and returns the appropriate OAuth error responses.
 */
export const tokenRequestBodySchema = t.object({
  grant_type: t.optional(t.text()),
  code: t.optional(t.text({ maxLength: 4096 })),
  client_id: t.optional(t.text()),
  redirect_uri: t.optional(t.text({ maxLength: 2048 })),
  code_verifier: t.optional(t.text({ maxLength: 256 })),
  refresh_token: t.optional(t.text({ maxLength: 4096 })),
  client_secret: t.optional(t.text({ maxLength: 512 })),
});
