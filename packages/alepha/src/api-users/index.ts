import { $module } from "alepha";
import { AlephaEmail } from "alepha/email";
import { IdentityController } from "./controllers/IdentityController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { UserController } from "./controllers/UserController.ts";
import { CredentialService } from "./services/CredentialService.ts";
import { IdentityService } from "./services/IdentityService.ts";
import { SessionCrudService } from "./services/SessionCrudService.ts";
import { SessionService } from "./services/SessionService.ts";
import { UserService } from "./services/UserService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/IdentityController.ts";
export * from "./controllers/SessionController.ts";
export * from "./controllers/UserController.ts";
export * from "./descriptors/$userRealm.ts";
export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./schemas/createUserSchema.ts";
export * from "./schemas/identityQuerySchema.ts";
export * from "./schemas/identityResourceSchema.ts";
export * from "./schemas/sessionQuerySchema.ts";
export * from "./schemas/sessionResourceSchema.ts";
export * from "./schemas/updateUserSchema.ts";
export * from "./schemas/userQuerySchema.ts";
export * from "./schemas/userResourceSchema.ts";
export * from "./services/CredentialService.ts";
export * from "./services/IdentityService.ts";
export * from "./services/SessionCrudService.ts";
export * from "./services/SessionService.ts";
export * from "./services/UserService.ts";

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
    AlephaEmail,
    SessionService,
    SessionCrudService,
    CredentialService,
    UserService,
    IdentityService,
    UserController,
    SessionController,
    IdentityController,
  ],
});
