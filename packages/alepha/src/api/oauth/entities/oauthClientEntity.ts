import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A registered OAuth 2.1 client application.
 *
 * Rows are created by Dynamic Client Registration (RFC 7591) when an MCP
 * client (e.g. Claude) first connects. `source` records who created the
 * client; for DCR it is always `"dcr"` and `createdByUserId` is null until
 * a user completes an authorization.
 */
export const oauthClientEntity = $entity({
  name: "oauth_clients",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    clientId: z.text({ maxLength: 64 }),
    clientName: z.text({ maxLength: 200 }),
    redirectUris: db.default(z.array(z.text({ maxLength: 2048 })), []),
    scopes: db.default(z.array(z.text({ maxLength: 64 })), []),
    realm: z.text({ maxLength: 100 }),
    /**
     * OAuth client type. `confidential` clients authenticate at the token
     * endpoint with a secret; `public` clients rely on PKCE only.
     */
    type: db.default(z.enum(["public", "confidential"]), "public"),
    /**
     * First-party client: skip the consent screen. Consent exists to protect a
     * user from THIRD-party apps requesting their data; a trusted client is the
     * authorization server's own product (same vendor), so an authenticated
     * user is sent straight back with a code — no "App X wants to connect" page.
     */
    trusted: db.default(z.boolean(), false),
    /**
     * Scrypt hash of the client secret (confidential clients only). Null for
     * public clients. Verified via `OAuthClientService.verifySecret`.
     */
    clientSecretHash: z.text({ maxLength: 256 }).optional(),
    source: db.default(z.text({ maxLength: 16 }), "dcr"),
    createdByUserId: z.uuid().optional(),
    lastUsedAt: z.datetime().optional(),
    revokedAt: z.datetime().optional(),
  }),
  indexes: [{ columns: ["clientId"], unique: true }],
});

export type OAuthClientEntity = Infer<typeof oauthClientEntity.schema>;
