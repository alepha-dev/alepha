import { type Infer, z } from "alepha";

/**
 * The signed-in account as exposed to ITSELF.
 *
 * Deliberately not `users.schema`. The entity carries fields that are an
 * operator's business and not the account holder's — `realm`,
 * `organizationId`, `enabled`, `version` — and returning the row wholesale
 * means every column added to `users` in future is published to the browser
 * the day it lands, with nobody deciding that it should be.
 *
 * So this is an allowlist, and adding a field here is the deliberate act.
 */
export const myProfileSchema = z.object({
  id: z.uuid(),
  username: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean(),
  phoneNumber: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),

  /**
   * File id for the avatar, served through the files module.
   */
  picture: z.string().optional(),

  /**
   * Shown so a person can see what they are, not so the client can gate on
   * it — authorization is decided server-side on every call.
   */
  roles: z.array(z.string()),

  createdAt: z.datetime(),
  lastLoginAt: z.datetime().optional(),
});

export type MyProfile = Infer<typeof myProfileSchema>;
