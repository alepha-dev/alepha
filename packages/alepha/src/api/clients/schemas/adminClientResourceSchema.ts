import { t } from "alepha";

/**
 * Resource schema for admin OAuth2 client views.
 */
export const adminClientResourceSchema = t.object({
  id: t.uuid(),
  clientId: t.string(),
  name: t.string(),
  description: t.optional(t.string()),
  logoUri: t.optional(t.string()),
  clientUri: t.optional(t.string()),
  realm: t.string(),
  redirectUris: t.array(t.string()),
  grantTypes: t.array(t.string()),
  responseTypes: t.array(t.string()),
  scopes: t.array(t.string()),
  tokenEndpointAuthMethod: t.string(),
  firstParty: t.boolean(),
  enabled: t.boolean(),
  clientIdIsUrl: t.boolean(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
});
