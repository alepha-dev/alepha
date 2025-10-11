import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/verifications.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides verification management API endpoints for Alepha applications.
 *
 * This module includes verification code management for multifactor authentication and other verification flows.
 * - Create and send verification codes via email or SMS.
 * - Validate verification codes submitted by users.
 *
 * @module alepha.api.verifications
 */
export const AlephaApiVerifications = $module({
	name: "alepha.api.verifications",
	services: [],
});
