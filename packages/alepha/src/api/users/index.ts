import { $module } from "alepha";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail } from "alepha/email";
import { AlephaServerCompress } from "alepha/server/compress";
import { AlephaServerHelmet } from "alepha/server/helmet";
import { AdminIdentityController } from "./controllers/AdminIdentityController.ts";
import { AdminSessionController } from "./controllers/AdminSessionController.ts";
import { AdminUserController } from "./controllers/AdminUserController.ts";
import { RealmController } from "./controllers/RealmController.ts";
import { UserController } from "./controllers/UserController.ts";
import { UserNotifications } from "./notifications/UserNotifications.ts";
import { RealmProvider } from "./providers/RealmProvider.ts";
import { CredentialService } from "./services/CredentialService.ts";
import { IdentityService } from "./services/IdentityService.ts";
import { RegistrationService } from "./services/RegistrationService.ts";
import { SessionCrudService } from "./services/SessionCrudService.ts";
import { SessionService } from "./services/SessionService.ts";
import { UserService } from "./services/UserService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/realmAuthSettingsAtom.ts";
export * from "./controllers/AdminIdentityController.ts";
export * from "./controllers/AdminSessionController.ts";
export * from "./controllers/AdminUserController.ts";
export * from "./controllers/RealmController.ts";
export * from "./controllers/UserController.ts";
export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./primitives/$realm.ts";
export * from "./providers/RealmProvider.ts";
export * from "./schemas/completePasswordResetRequestSchema.ts";
export * from "./schemas/completeRegistrationRequestSchema.ts";
export * from "./schemas/createUserSchema.ts";
export * from "./schemas/identityQuerySchema.ts";
export * from "./schemas/identityResourceSchema.ts";
export * from "./schemas/loginSchema.ts";
export * from "./schemas/passwordResetIntentResponseSchema.ts";
export * from "./schemas/realmConfigSchema.ts";
export * from "./schemas/registerSchema.ts";
export * from "./schemas/registrationIntentResponseSchema.ts";
export * from "./schemas/resetPasswordSchema.ts";
export * from "./schemas/sessionQuerySchema.ts";
export * from "./schemas/sessionResourceSchema.ts";
export * from "./schemas/updateUserSchema.ts";
export * from "./schemas/userQuerySchema.ts";
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
    AlephaServerHelmet,
    AlephaServerCompress,
    AlephaEmail,
    RealmProvider,
    SessionService,
    SessionCrudService,
    CredentialService,
    RegistrationService,
    UserService,
    IdentityService,
    UserController,
    AdminUserController,
    AdminSessionController,
    AdminIdentityController,
    RealmController,
    UserNotifications,
  ],
});
