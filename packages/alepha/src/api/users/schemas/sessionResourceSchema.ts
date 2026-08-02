import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * Slim view of the session's owner — embedded by the admin listing so the
 * UI can render a human-readable identifier instead of just a UUID. Comes
 * back via a left join, so it's optional (a session whose user was deleted
 * still returns; `user` is undefined).
 */
export const sessionUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string().meta({ format: "email" }).optional(),
  username: z.shortText({ minLength: 3, maxLength: 30 }).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

/**
 * Admin-facing session projection. Deliberately WITHOUT `refreshToken`: a
 * refresh token is a long-lived bearer credential, and exposing it here
 * would hand full user impersonation to anyone who can read admin API
 * responses (UI, logs, proxies). `MySessionController` omits it for the
 * same reason.
 */
export const sessionResourceSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
  userId: z.uuid(),
  expiresAt: z.datetime(),
  ip: z.string().optional(),
  country: z.string().optional(),
  userAgent: z
    .object({
      os: z.string(),
      browser: z.string(),
      device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
    })
    .optional(),
  user: sessionUserSummarySchema.optional(),
});

export type SessionResource = Infer<typeof sessionResourceSchema>;
