import { type Infer, z } from "alepha";

import { ESTATE_TYPES } from "../entities/estates.ts";

/**
 * One row of the instance-wide estates list in the admin shell (#1838).
 *
 * The backstop for an estate whose owner is gone or unresponsive: enough to
 * find it, see whether a machine is still behind it, and delete it. Built by
 * hand rather than derived from the entity, for the reason the lent view is:
 * a field added to `estates` must be a decision to show here, not a default.
 *
 * ⚠️ No credential, and no exception carved for the admin role. A bay secret
 * is stored hashed and a cloudflare token sealed, and no read path returns
 * either to anyone; `secretPrefix` is here so the row can name a credential
 * it cannot rebuild, the same as the owner sees.
 */
export const adminEstateResourceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string().optional(),
  type: z.enum(ESTATE_TYPES),
  secretPrefix: z.string().optional(),
  /**
   * `cloudflare` only: the account its token was checked against. The
   * account id names the destination, which is what an admin looking at
   * somebody else's estate needs; the token itself never crosses (#1629).
   */
  accountId: z.string().optional(),
  ownerUserId: z.uuid(),
  /**
   * Display name for `ownerUserId`, resolved for the page being displayed.
   * Optional because the owner may be mid-deletion; the id stays so the row
   * can link to the user regardless.
   */
  ownerName: z.string().optional(),
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
   * Projects this estate is lent to, counted for the page only.
   */
  projectCount: z.integer(),
});

export type AdminEstateResource = Infer<typeof adminEstateResourceSchema>;
