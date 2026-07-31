import { $module } from "alepha";
import { SessionAudits } from "./audits/SessionAudits.ts";
import { UserAudits } from "./audits/UserAudits.ts";
import { AdminIdentityController } from "./controllers/AdminIdentityController.ts";
import { AdminSessionController } from "./controllers/AdminSessionController.ts";
import { AdminUserController } from "./controllers/AdminUserController.ts";
import { MyPasswordController } from "./controllers/MyPasswordController.ts";
import { MySessionController } from "./controllers/MySessionController.ts";
import { RealmController } from "./controllers/RealmController.ts";
import { UserController } from "./controllers/UserController.ts";
import { UserJobs } from "./jobs/UserJobs.ts";
import { UserNotifications } from "./notifications/UserNotifications.ts";
import { RealmProvider } from "./providers/RealmProvider.ts";
import { CredentialService } from "./services/CredentialService.ts";
import { IdentityService } from "./services/IdentityService.ts";
import { RegistrationService } from "./services/RegistrationService.ts";
import { SessionCrudService } from "./services/SessionCrudService.ts";
import { SessionService } from "./services/SessionService.ts";
import { UsernameSlugger } from "./services/UsernameSlugger.ts";
import { UserService } from "./services/UserService.ts";
import { UserStorage } from "./storage/UserStorage.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/realmAuthSettingsAtom.ts";
export * from "./audits/SessionAudits.ts";
export * from "./audits/UserAudits.ts";
export * from "./controllers/AdminIdentityController.ts";
export * from "./controllers/AdminSessionController.ts";
export * from "./controllers/AdminUserController.ts";
export * from "./controllers/MyPasswordController.ts";
export * from "./controllers/MySessionController.ts";
export * from "./controllers/RealmController.ts";
export * from "./controllers/UserController.ts";
export * from "./entities/identities.ts";
export * from "./entities/sessions.ts";
export * from "./entities/users.ts";
export * from "./jobs/UserJobs.ts";
export * from "./notifications/UserNotifications.ts";
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
export * from "./services/UsernameSlugger.ts";
export * from "./services/UserService.ts";
export * from "./storage/UserStorage.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Complete user management with multi-realm support for multi-tenant applications.
 *
 * **Features:**
 * - User registration, login, and profile management
 * - Password reset workflows
 * - Email verification
 * - Session management with multiple devices
 * - Identity management (social logins, SSO)
 * - Multi-realm support for tenant isolation
 * - Credential management
 * - Entities: `users`, `identities`, `sessions`
 *
 * @module alepha.api.users
 */
export const AlephaApiUsers = $module({
  name: "alepha.api.users",
  services: [
    RealmProvider,
    SessionService,
    SessionCrudService,
    CredentialService,
    RegistrationService,
    UserService,
    UsernameSlugger,
    IdentityService,
    UserController,
    AdminUserController,
    AdminSessionController,
    MyPasswordController,
    MySessionController,
    AdminIdentityController,
    RealmController,
  ],
  variants: [
    UserJobs,
    UserNotifications,
    UserAudits,
    SessionAudits,
    UserStorage,
  ],
});
