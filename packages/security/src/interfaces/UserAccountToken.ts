import type { UserAccountInfo } from "../schemas/userAccountInfoSchema";

export interface UserAccountToken extends UserAccountInfo {
	/**
	 * Access token for the user.
	 */
	token?: string;

	realm?: string;

	/**
	 * Is user dedicated to his own resources for this scope ?
	 * Mostly, Admin is false and Customer is true.
	 */
	ownership?: string | boolean;
}
