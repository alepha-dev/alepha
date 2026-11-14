import { type Infer, z } from "alepha";

import { HOST_TYPES } from "../entities/hosts.ts";

/**
 * One row of the instance-wide hosts list in the admin shell (#1838).
 *
 * The backstop for a host with no home, or one whose project is gone:
 * enough to find it, see whether a machine is still behind it, and assign
 * it a home or delete it. Built by
 * hand rather than derived from the entity, for the reason the lent view is:
 * a field added to `hosts` must be a decision to show here, not a default.
 *
 * ⚠️ No credential, and no exception carved for the admin role. A bay secret
 * is stored hashed and a cloudflare token sealed, and no read path returns
 * either to anyone; `secretPrefix` is here so the row can name a credential
 * it cannot rebuild, the same as the owner sees.
 */
export const adminHostResourceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string().optional(),
  type: z.enum(HOST_TYPES),
  secretPrefix: z.string().optional(),
  /**
   * `cloudflare` only: the account its token was checked against. The
   * account id names the destination, which is what an admin looking at
   * somebody else's host needs; the token itself never crosses (#1629).
   */
  accountId: z.string().optional(),
  /**
   * The home project (#E126), absent for a host with no home: the rows
   * the admin assigns.
   */
  project: z
    .object({ id: z.integer(), title: z.string(), slug: z.string().optional() })
    .optional(),
  /**
   * Who added it, by name, so a host with no home says whose it was.
   * Absent when that account is gone.
   */
  creator: z.object({ id: z.uuid(), name: z.string() }).optional(),
  online: z.boolean(),
  /**
   * Cloudflare only. Shown instead of the online badge, which means nothing
   * on a row that never connects (#1630).
   */
  credentialStatus: z.enum(["valid", "invalid"]).optional(),
  deployAllowed: z.boolean(),
  lastSeenAt: z.string().optional(),
  createdAt: z.datetime(),
  /**
   * The projects this host is lent to, by name, oldest loan first: where
   * a host with no home is normally assigned.
   */
  loans: z.array(
    z.object({
      id: z.integer(),
      title: z.string(),
      slug: z.string().optional(),
    }),
  ),
});

export type AdminHostResource = Infer<typeof adminHostResourceSchema>;
