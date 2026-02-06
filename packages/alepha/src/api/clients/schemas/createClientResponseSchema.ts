import { t } from "alepha";

/**
 * Response when creating a new OAuth2 client.
 * The clientSecret is only returned once at creation time.
 */
export const createClientResponseSchema = t.object({
  id: t.uuid(),
  clientId: t.string(),
  clientSecret: t.optional(t.string()),
  name: t.string(),
  redirectUris: t.array(t.string()),
  grantTypes: t.array(t.string()),
  scopes: t.array(t.string()),
  tokenEndpointAuthMethod: t.string(),
  firstParty: t.boolean(),
  createdAt: t.datetime(),
});
