import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

/**
 * Add contextual metadata to a user account info.
 * E.g. UserAccountToken is a UserAccountInfo during a request.
 */
export interface UserAccountToken extends UserAccount {
  /**
   * Access token for the user.
   */
  token?: string;

  /**
   * Realm name of the user.
   */
  realm?: string;

  /**
   * Is user dedicated to his own resources for this scope ?
   * Mostly, Admin is false and Customer is true.
   */
  ownership?: string | boolean;
}
