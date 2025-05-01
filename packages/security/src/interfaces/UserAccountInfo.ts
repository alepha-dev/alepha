import type { Role } from "../schemas/roleSchema";

/**
 * Represents a User Account extracted from JWT.
 */
export interface UserAccountInfo {
	/**
	 * ID of user account. Based on JWT.sub.
	 */
	id: string;

	/**
	 * Represents the roles assigned to a user.
	 */
	roles?: Role[];

	/**
	 * User full name, if available.
	 */
	name?: string;

	/**
	 * Organization ID, if available.
	 */
	organization?: string;
}
