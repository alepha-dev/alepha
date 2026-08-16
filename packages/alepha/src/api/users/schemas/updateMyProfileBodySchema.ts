import { type Infer, z } from "alepha";
import { users } from "../entities/users.ts";

/**
 * What the account holder may change about themselves in one call.
 *
 * **`firstName` / `lastName` are `.nullable()` so a name can be *unset*.** The
 * three states are distinct and all three are reachable: absent leaves the
 * field alone, a string sets it, `null` clears it. Without the null case an
 * account could only ever gain a first name — `undefined` is dropped from the
 * ORM patch, so "the box is empty" arrived as "don't touch this column", the
 * request succeeded, and the old value came back in the response. Nothing
 * failed; the edit just did not happen. `MyProfileController.spec.ts` pins all
 * three states.
 *
 * `username` takes no null: it is unique identity, the realm can require it,
 * and there is no coherent "account with no username" to clear it to.
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
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  username: users.schema.shape.username,
});

export type UpdateMyProfileBody = Infer<typeof updateMyProfileBodySchema>;
