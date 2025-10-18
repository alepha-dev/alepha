import { $module } from "@alepha/core";
import { AlephaEmail } from "@alepha/email";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaServerSecurity } from "@alepha/server-security";
import { UserController } from "./controllers/UserController.ts";
import { CredentialService } from "./services/CredentialService.ts";
import { SessionService } from "./services/SessionService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/UserController.ts";
export * from "./descriptors/$authApple.ts";
export * from "./descriptors/$authCredentials.ts";
export * from "./descriptors/$authGithub.ts";
export * from "./descriptors/$authGoogle.ts";
export * from "./descriptors/$realmUsers.ts";
export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./services/CredentialService.ts";
export * from "./services/SessionService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides user management API endpoints for Alepha applications.
 *
 * This module includes user CRUD operations, authentication endpoints,
 * password reset functionality, and user profile management capabilities.
 *
 * @module alepha.api.users
 */
export const AlephaApiUsers = $module({
	name: "alepha.api.users",
	services: [
		AlephaServerSecurity,
		AlephaReactAuth,
		AlephaEmail,
		SessionService,
		CredentialService,
		UserController,
	],
});
