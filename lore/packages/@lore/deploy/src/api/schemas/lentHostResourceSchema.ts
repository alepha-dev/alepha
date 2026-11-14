import { type Infer, z } from "alepha";

import { HOST_TYPES } from "../entities/hosts.ts";

/**
 * A host as a project's members see it: enough to pick it as a deploy
 * destination and to see whether the machine behind it is up, and nothing
 * that belongs to its home project alone.
 *
 * No `secretPrefix`, no switches beyond `deployAllowed` (which decides
 * whether the project can deploy through it at all), and its home project
 * named, because two projects may both have a host called `ovh-1` and a
 * member has to tell them apart.
 *
 * Built by hand rather than derived from the entity on purpose: a field
 * added to `hosts` must be a decision to show here, not a default.
 */
export const lentHostResourceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string().optional(),
  type: z.enum(HOST_TYPES),
  online: z.boolean(),
  deployAllowed: z.boolean(),
  acceptedRuntimes: z.array(z.string()),
  /**
   * Cloudflare only, and the one thing a member deciding whether to deploy
   * needs more than `online`: `online` is false for a row that never
   * connects, and "invalid" is the fact that matters (#1630).
   */
  credentialStatus: z.enum(["valid", "invalid"]).optional(),
  lastSeenAt: z.string().optional(),
  /**
   * A throwaway host's expiry, and whether it is past it (#Q3138).
   */
  expiresAt: z.string().optional(),
  overdue: z.boolean(),
  /**
   * The address its machine connected from (#Q3137).
   */
  publicIp: z.string().optional(),
  /**
   * Who sold the server, when lore host provision bought it, and its type
   * (#Q3168). The price and the server id stay on the owner's view.
   */
  provider: z.string().optional(),
  providerServerType: z.string().optional(),
  cpuPercent: z.number().optional(),
  memoryPercent: z.number().optional(),
  /**
   * The host's home project, whose members manage it (#E126). Absent for
   * a host with no home, which the admin has yet to assign.
   */
  home: z
    .object({ id: z.integer(), title: z.string(), slug: z.string().optional() })
    .optional(),
  /**
   * Whether the project this row is listed for is the host's home, or
   * only borrows it.
   */
  isHome: z.boolean(),
  /**
   * The reader's effective host permissions in the HOME project,
   * server-computed. Empty for a member of a borrowing project who is not a
   * member of the home: the console answers them 403, so a page links to it
   * only when this holds `host:read`, and offers Detach on the home side
   * only when it holds `host:lend`.
   */
  can: z.array(z.string()),
  lentAt: z.string(),
});

export type LentHostResource = Infer<typeof lentHostResourceSchema>;

/**
 * A lent host plus the one cleartext copy of a secret Lore minted, if it
 * minted one, for the create-from-inside-a-project flow.
 *
 * Same rule as `mintedHostSchema`, including the optionality: nothing can
 * produce the secret again, and a cloudflare create produces none at all, so
 * the field is **absent** rather than empty.
 */
export const mintedLentHostSchema = lentHostResourceSchema.extend({
  secret: z.string().optional(),
});

export type MintedLentHost = Infer<typeof mintedLentHostSchema>;
