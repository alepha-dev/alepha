import type { Infer } from "alepha";

import { users } from "../entities/users.ts";

/**
 * What an admin may change on a user.
 *
 * `realm` and `organizationId` are NOT in it, and that is the point. Both
 * used to be accepted and written straight through to the row, so a realm
 * admin could move any user they could reach into another realm - out of
 * their own scope and into someone else's, taking the account's roles with
 * it - or reassign it to another tenant's organization.
 *
 * A user belongs to one realm for life; there is no supported way to move
 * one. Organization membership changes belong to the organization surface,
 * which knows about invitations and seats.
 */
export const updateUserSchema = users.insertSchema
  .omit({
    id: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    realm: true,
    organizationId: true,
  })
  .partial();

export type UpdateUser = Infer<typeof updateUserSchema>;
