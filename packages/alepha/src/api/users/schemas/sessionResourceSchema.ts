import type { Static } from "alepha";
import { t } from "alepha";

/**
 * Slim view of the session's owner — embedded by the admin listing so the
 * UI can render a human-readable identifier instead of just a UUID. Comes
 * back via a left join, so it's optional (a session whose user was deleted
 * still returns; `user` is undefined).
 */
export const sessionUserSummarySchema = t.object({
  id: t.uuid(),
  email: t.optional(t.string({ format: "email" })),
  username: t.optional(t.shortText({ minLength: 3, maxLength: 30 })),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
});

export const sessionResourceSchema = t.object({
  id: t.uuid(),
  version: t.number(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  refreshToken: t.uuid(),
  userId: t.uuid(),
  expiresAt: t.datetime(),
  ip: t.optional(t.string()),
  userAgent: t.optional(
    t.object({
      os: t.string(),
      browser: t.string(),
      device: t.enum(["MOBILE", "DESKTOP", "TABLET"]),
    }),
  ),
  user: t.optional(sessionUserSummarySchema),
});

export type SessionResource = Static<typeof sessionResourceSchema>;
