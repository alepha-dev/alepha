import { t } from "alepha";

/**
 * Schema for creating a new OAuth2 client.
 */
export const createClientBodySchema = t.object({
  name: t.text({ minLength: 1, maxLength: 200 }),
  description: t.optional(t.text({ maxLength: 500 })),
  logoUri: t.optional(t.text()),
  clientUri: t.optional(t.text()),
  redirectUris: t.array(t.text()),
  grantTypes: t.optional(t.array(t.text())),
  scopes: t.optional(t.array(t.text())),
  tokenEndpointAuthMethod: t.optional(
    t.enum(["none", "client_secret_basic", "client_secret_post"]),
  ),
  firstParty: t.optional(t.boolean()),
});
