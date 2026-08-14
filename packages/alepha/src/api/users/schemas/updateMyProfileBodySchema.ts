import { type Infer, z } from "alepha";
import { users } from "../entities/users.ts";

/**
 * What the account holder may change about themselves in one call.
 *
 * `username` reuses the entity's own column schema rather than restating its
 * bounds — the same reasoning `MyPasswordController` gives for not restating
 * the realm's password policy at the edge. A second declaration of "3 to 30
 * characters" here would agree with the entity exactly until the day one of
 * them moves.
 *
 * **`email` is absent on purpose.** Changing an email is a verification flow
 * — issue a token, prove control of the new address, only then swap it —
 * and accepting it as a profile edit would let anyone with a borrowed
 * session redirect the account's password resets to an address they own.
 */
export const updateMyProfileBodySchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  username: users.schema.shape.username,
});

export type UpdateMyProfileBody = Infer<typeof updateMyProfileBodySchema>;
