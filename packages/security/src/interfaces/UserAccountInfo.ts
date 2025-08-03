/**
 * Represents a User Account extracted from JWT.
 */
export interface UserAccountInfo {
	/**
	 * ID of user account. Based on JWT.sub.
	 */
	id: string;

	/**
	 * User full name, if available.
	 */
	name?: string;

	/**
	 * User email, if available.
	 */
	email?: string;

	/**
	 * User profile picture URL, if available.
	 */
	picture?: string;

	/**
	 * List of organizations the user belongs to, if available.
	 */
	organizations?: string[];

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Represents the roles assigned to a user.
	 */
	roles?: string[];
}
