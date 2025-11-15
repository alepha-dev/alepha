import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/orm";
import { users } from "./users.ts";

export const sessions = $entity({
  name: "sessions",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    refreshToken: t.uuid(),
    userId: pg.ref(t.uuid(), () => users.cols.id),
    expiresAt: t.datetime(),
    ip: t.optional(t.string()),
    userAgent: t.optional(
      t.object({
        os: t.string(),
        browser: t.string(),
        device: t.enum(["MOBILE", "DESKTOP", "TABLET"]),
      }),
    ),
  }),
});

export type SessionEntity = Static<typeof sessions.schema>;
