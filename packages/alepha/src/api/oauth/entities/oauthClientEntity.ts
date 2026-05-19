import { type Static, t } from "alepha";
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
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    clientId: t.text({ maxLength: 64 }),
    clientName: t.text({ maxLength: 200 }),
    redirectUris: db.default(t.array(t.text({ maxLength: 2048 })), []),
    scopes: db.default(t.array(t.text({ maxLength: 64 })), []),
    realm: t.text({ maxLength: 100 }),
    source: db.default(t.text({ maxLength: 16 }), "dcr"),
    createdByUserId: t.optional(t.uuid()),
    lastUsedAt: t.optional(t.datetime()),
    revokedAt: t.optional(t.datetime()),
  }),
  indexes: [{ columns: ["clientId"], unique: true }],
});

export type OAuthClientEntity = Static<typeof oauthClientEntity.schema>;
