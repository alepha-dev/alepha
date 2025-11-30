import { $module } from "alepha";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail } from "alepha/email";
import { IdentityController } from "./controllers/IdentityController.ts";
import { SessionController } from "./controllers/SessionController.ts";
import { UserController } from "./controllers/UserController.ts";
import { UserRealmController } from "./controllers/UserRealmController.ts";
import { UserRealmProvider } from "./providers/UserRealmProvider.ts";
import { CredentialService } from "./services/CredentialService.ts";
import { IdentityService } from "./services/IdentityService.ts";
import { RegistrationService } from "./services/RegistrationService.ts";
import { SessionCrudService } from "./services/SessionCrudService.ts";
import { SessionService } from "./services/SessionService.ts";
import { UserService } from "./services/UserService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/realmAuthSettingsAtom.ts";
export * from "./controllers/IdentityController.ts";
export * from "./controllers/SessionController.ts";
export * from "./controllers/UserController.ts";
export * from "./controllers/UserRealmController.ts";
export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./primitives/$userRealm.ts";
export * from "./providers/UserRealmProvider.ts";
export * from "./schemas/completePasswordResetRequestSchema.ts";
export * from "./schemas/completeRegistrationRequestSchema.ts";
export * from "./schemas/createUserSchema.ts";
export * from "./schemas/identityQuerySchema.ts";
export * from "./schemas/identityResourceSchema.ts";
export * from "./schemas/loginSchema.ts";
export * from "./schemas/passwordResetIntentResponseSchema.ts";
export * from "./schemas/registerSchema.ts";
export * from "./schemas/registrationIntentResponseSchema.ts";
export * from "./schemas/resetPasswordSchema.ts";
export * from "./schemas/sessionQuerySchema.ts";
export * from "./schemas/sessionResourceSchema.ts";
export * from "./schemas/updateUserSchema.ts";
export * from "./schemas/userQuerySchema.ts";
export * from "./schemas/userRealmConfigSchema.ts";
export * from "./schemas/userResourceSchema.ts";
export * from "./services/CredentialService.ts";
export * from "./services/IdentityService.ts";
export * from "./services/RegistrationService.ts";
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
    AlephaApiVerification,
    AlephaApiNotifications,
    AlephaEmail,
    UserRealmProvider,
    SessionService,
    SessionCrudService,
    CredentialService,
    RegistrationService,
    UserService,
    IdentityService,
    UserController,
    SessionController,
    IdentityController,
    UserRealmController,
  ],
});
