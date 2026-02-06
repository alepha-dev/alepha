import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * OAuth2 client registration.
 *
 * Stores registered OAuth2 clients that can request tokens
 * via authorization code or client credentials grants.
 */
export const oauthClientEntity = $entity({
  name: "oauth_clients",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    // Identity
    realm: t.text(),
    clientId: t.text({ maxLength: 255 }),
    clientSecretHash: t.optional(t.text({ maxLength: 256 })),
    name: t.text({ maxLength: 200 }),
    description: t.optional(t.text({ maxLength: 500 })),
    logoUri: t.optional(t.text()),
    clientUri: t.optional(t.text()),

    // OAuth2 configuration
    redirectUris: db.default(t.array(t.text()), []),
    grantTypes: db.default(t.array(t.text()), ["authorization_code"]),
    responseTypes: db.default(t.array(t.text()), ["code"]),
    scopes: db.default(t.array(t.text()), []),
    tokenEndpointAuthMethod: db.default(
      t.enum(["none", "client_secret_basic", "client_secret_post"]),
      "client_secret_basic",
    ),

    // Behavior
    firstParty: db.default(t.boolean(), false),
    enabled: db.default(t.boolean(), true),

    // For Client ID Metadata Documents (MCP)
    clientIdIsUrl: db.default(t.boolean(), false),
  }),
  indexes: [{ columns: ["clientId"], unique: true }, { columns: ["realm"] }],
});

export type OAuthClientEntity = Static<typeof oauthClientEntity.schema>;
