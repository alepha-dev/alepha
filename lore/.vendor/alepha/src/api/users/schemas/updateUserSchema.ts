import type { Infer } from "alepha";

import { users } from "../entities/users.ts";
import { refusedRealmSchema } from "./refusedRealmSchema.ts";

/**
 * What an admin may change on a user.
 *
 * `realm` is NOT in it, and that is the point. It used to be accepted and
 * written straight through to the row, so a realm
 * admin could move any user they could reach into another realm - out of
 * their own scope and into someone else's, taking the account's roles with
 * it.
 *
 * A user belongs to one realm for life; there is no supported way to move
 * one.
 */
export const updateUserSchema = users.insertSchema
  .omit({
    id: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    realm: true,
  })
  .partial()
  // Omitted above so it cannot be written, and refused here so it cannot be
  // sent and silently ignored either.
  .extend({ realm: refusedRealmSchema });

export type UpdateUser = Infer<typeof updateUserSchema>;
