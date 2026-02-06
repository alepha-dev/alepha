import { t } from "alepha";

/**
 * OAuth2 token introspection response (RFC 7662).
 */
export const oauth2IntrospectionResponseSchema = t.object({
  active: t.boolean(),
  sub: t.optional(t.string()),
  client_id: t.optional(t.string()),
  scope: t.optional(t.string()),
  exp: t.optional(t.number()),
  iat: t.optional(t.number()),
  aud: t.optional(t.string()),
  token_type: t.optional(t.string()),
});
