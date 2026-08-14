import { type Infer, z } from "alepha";

/**
 * What it takes to delete your own account.
 *
 * Two independent proofs, because the two failure modes are different
 * people. `currentPassword` proves it is *you* — it stops someone who walked
 * up to an unlocked, signed-in laptop. `confirm` proves you *meant it* — it
 * stops you, five seconds from now, having clicked the wrong button.
 *
 * Neither substitutes for the other, which is why this is not just a
 * password prompt and not just a typed confirmation.
 */
export const deleteMyAccountBodySchema = z.object({
  /**
   * Required whenever the account has a `credentials` identity. Omitted for
   * an OAuth-only account, which has no password to prove knowledge of —
   * there, `confirm` carries the whole weight.
   *
   * No length bound: the realm's own policy decides what a password is, and
   * a bound here would disagree with it the day either moves.
   */
  currentPassword: z.text().optional(),

  /**
   * The account's email, typed verbatim. Falls back to the username when
   * there is no email, and to the literal `DELETE` when the account has
   * neither — both columns are optional on the entity, and without the
   * chain "confirm by typing your email" would silently degrade into
   * "confirm by typing nothing" for exactly the accounts least able to
   * recover.
   */
  confirm: z.text(),
});

export type DeleteMyAccountBody = Infer<typeof deleteMyAccountBodySchema>;
