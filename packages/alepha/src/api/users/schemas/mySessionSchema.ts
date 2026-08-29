import { type Infer, z } from "alepha";

/**
 * A session as exposed to ITS OWNER — `refreshToken` is deliberately
 * omitted (returning it would let any XSS exfiltrate a long-lived
 * credential); `current` flags the session backing the calling request.
 */
export const mySessionSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  expiresAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  ip: z.string().optional(),
  country: z.string().optional(),
  userAgent: z
    .object({
      os: z.string(),
      browser: z.string(),
      device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
    })
    .optional(),
  current: z.boolean(),
});

export type MySession = Infer<typeof mySessionSchema>;
