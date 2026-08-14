import { type Infer, z } from "alepha";

/**
 * One OAuth client holding a live session on the caller's account — an MCP
 * client, a CLI, a third-party integration.
 *
 * A connection IS a session: the same row `MySessionController` lists, with a
 * `clientId` set and the client's display name resolved. It is presented
 * separately because the two answer different questions — "where am I signed
 * in" versus "what has access to my account" — and because revoking a
 * connection is a decision about software, not about a device.
 *
 * `refreshToken` is deliberately absent for the same reason it is absent from
 * `mySessionSchema`: returning it would let any XSS exfiltrate a long-lived
 * credential.
 */
export const myConnectionSchema = z.object({
  id: z.uuid(),

  /**
   * The registered OAuth client id. Kept alongside the name because the name
   * is display text an operator can change, while this is the stable handle.
   */
  clientId: z.string(),

  /**
   * The client's registered display name, falling back to `clientId` when the
   * client registration has since been deleted — a session can outlive it.
   */
  clientName: z.string(),

  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  expiresAt: z.datetime(),
  ip: z.string().optional(),
  userAgent: z
    .object({
      os: z.string(),
      browser: z.string(),
      device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
    })
    .optional(),

  /**
   * True when this connection is the one making the request — an MCP client
   * listing its own access.
   */
  current: z.boolean(),
});

export type MyConnection = Infer<typeof myConnectionSchema>;
