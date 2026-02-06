import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * OAuth2 consent grants.
 *
 * Persists user consent so they don't re-approve
 * the same client/scopes on every authorization.
 */
export const oauthGrantEntity = $entity({
  name: "oauth_grants",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    userId: t.uuid(),
    clientId: t.text(),
    realm: t.text(),
    scopes: t.array(t.text()),
    revokedAt: t.optional(t.datetime()),
  }),
  indexes: [{ columns: ["userId", "clientId", "realm"], unique: true }],
});

export type OAuthGrantEntity = Static<typeof oauthGrantEntity.schema>;
