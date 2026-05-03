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
