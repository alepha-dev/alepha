import { type Infer, z } from "alepha";

/**
 * One OAuth client holding access to the caller's account — an MCP client, a
 * CLI, a third-party integration.
 *
 * ⚠️ **One entry per CLIENT, not per session.** It used to be one per
 * session, and the result on production was an account listing four
 * live-looking "Claude" rows of which one was live: claude.ai registers a
 * fresh client on every connect, nothing tells Lore when a person
 * disconnects on the client side, and each abandoned session then ran its
 * full 180-day term. Grouping is also what makes the confirm dialog's own
 * words true - "it loses access immediately" is a claim about an app, and
 * revoking one of four sessions did not make it so.
 *
 * The read groups; nothing is destroyed to achieve it. That distinction is
 * load-bearing: since DCR dedupe, Claude web, desktop and mobile share one
 * `client_id`, so collapsing by deleting older sessions would sign the other
 * devices out.
 *
 * It is presented separately from `mySessionSchema` because the two answer
 * different questions — "where am I signed in" versus "what has access to my
 * account" — and because revoking a connection is a decision about software,
 * not about a device.
 *
 * `refreshToken` is deliberately absent for the same reason it is absent from
 * `mySessionSchema`: returning it would let any XSS exfiltrate a long-lived
 * credential.
 */
export const myConnectionSchema = z.object({
  /**
   * The client id, which is also this entry's identity: revoking addresses
   * a CLIENT now, not one of its sessions.
   *
   * ⚠️ Not a uuid. `sessions.clientId` holds the registered OAuth client id
   * (`mcp_<hex>`, or whatever Platform seeded), so a `z.uuid()` here would
   * refuse every real value.
   */
  id: z.text({ maxLength: 64 }),

  /**
   * The registered OAuth client id. Kept alongside the name because the name
   * is display text an operator can change, while this is the stable handle.
   * Equal to `id`; both are here so a caller reading either is right.
   */
  clientId: z.string(),

  /**
   * The client's registered display name, falling back to `clientId` when the
   * client registration has since been deleted — a session can outlive it.
   */
  clientName: z.string(),

  /**
   * When this app FIRST got access: the oldest of its sessions. "Connected
   * 8 days ago" is a fact about the app, not about its newest reconnect.
   */
  createdAt: z.datetime(),

  /**
   * The newest `lastUsedAt` across the app's sessions.
   */
  lastUsedAt: z.datetime().optional(),

  /**
   * The latest expiry across them, which is when access actually ends if
   * nobody revokes it.
   */
  expiresAt: z.datetime(),

  /**
   * How many sessions this one entry stands for. One in the ordinary case;
   * more when the same app was authorized several times, which the UI says
   * out loud rather than hiding.
   */
  sessionCount: z.integer(),
  ip: z.string().optional(),
  userAgent: z
    .object({
      os: z.string(),
      browser: z.string(),
      device: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]),
    })
    .optional(),

  /**
   * True when ANY of this app's sessions is the one making the request — an
   * MCP client listing its own access.
   */
  current: z.boolean(),
});

export type MyConnection = Infer<typeof myConnectionSchema>;
