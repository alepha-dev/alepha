import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const sessions = $entity({
  name: "sessions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    refreshToken: t.uuid(),
    userId: db.ref(t.uuid(), () => users.cols.id),
    /**
     * OAuth client this session was minted for, when it was created via the
     * OAuth 2.1 authorization flow — the `client_id` of an `oauth_clients`
     * row. Null for first-party logins. Deliberately NOT a DB-level foreign
     * key: `sessions` is a core entity and must not depend on the optional
     * OAuth module's table; the join to `oauth_clients` is done at query time.
     */
    clientId: t.optional(t.text({ maxLength: 64 })),
    expiresAt: t.datetime(),
    /**
     * Last time the session was used to refresh an access token.
     * Used by realm `refreshToken.expirationIdle` to invalidate idle sessions.
     * `null` on existing rows pre-migration — falls back to `createdAt`.
     */
    lastUsedAt: t.optional(t.datetime()),
    ip: t.optional(t.text()),
    userAgent: t.optional(
      t.object({
        os: t.text(),
        browser: t.text(),
        device: t.enum(["MOBILE", "DESKTOP", "TABLET"]),
      }),
    ),
  }),
  indexes: ["userId", "expiresAt", { column: "refreshToken", unique: true }],
});

export type SessionEntity = Static<typeof sessions.schema>;
