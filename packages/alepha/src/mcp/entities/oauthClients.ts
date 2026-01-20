import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * OAuth2 client entity for MCP authentication.
 *
 * Stores client credentials (clientId/clientSecret) that can be used
 * to authenticate MCP requests using the OAuth2 client credentials grant.
 */
export const oauthClients = $entity({
  name: "mcp_oauth_clients",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * Unique client identifier used in OAuth2 flows.
     */
    clientId: t.text(),
    /**
     * Hashed client secret (never store plaintext).
     */
    clientSecretHash: t.text(),
    /**
     * Human-readable name for the client.
     */
    name: t.text(),
    /**
     * Description of what this client is used for.
     */
    description: t.optional(t.text()),
    /**
     * OAuth2 scopes granted to this client.
     * Example: ["mcp:tools:*", "mcp:resources:read"]
     */
    scopes: db.default(t.array(t.text()), []),
    /**
     * Whether the client is currently active.
     */
    enabled: db.default(t.boolean(), true),
    /**
     * Optional user ID that owns this client.
     */
    ownerId: t.optional(t.uuid()),
    /**
     * Optional metadata for the client.
     */
    metadata: t.optional(t.json()),
  }),
});

export type OAuthClientEntity = Static<typeof oauthClients.schema>;
