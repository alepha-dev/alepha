import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const sessions = $entity({
  name: "sessions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    refreshToken: z.uuid(),
    userId: db.ref(z.uuid(), () => users.cols.id),
    /**
     * OAuth client this session was minted for, when it was created via the
     * OAuth 2.1 authorization flow — the `client_id` of an `oauth_clients`
     * row. Null for first-party logins. Deliberately NOT a DB-level foreign
     * key: `sessions` is a core entity and must not depend on the optional
     * OAuth module's table; the join to `oauth_clients` is done at query time.
     */
    clientId: z.text({ maxLength: 64 }).optional(),
    expiresAt: z.datetime(),
    /**
     * Last time the session was used to refresh an access token.
     * Used by realm `refreshToken.expirationIdle` to invalidate idle sessions.
     * `null` on existing rows pre-migration — falls back to `createdAt`.
     */
    lastUsedAt: z.datetime().optional(),
    ip: z.text().optional(),
    /**
     * ISO 3166-1 alpha-2 country code derived from the request geo headers
     * (`cf-ipcountry` on Cloudflare, CDN equivalents elsewhere) at login time.
     * `null` on pre-migration rows and where geo isn't available.
     */
    country: z.text({ maxLength: 2 }).optional(),
    userAgent: z
      .object({
        os: z.text(),
        browser: z.text(),
        device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
      })
      .optional(),
  }),
  indexes: ["userId", "expiresAt", { column: "refreshToken", unique: true }],
});

export type SessionEntity = Infer<typeof sessions.schema>;
