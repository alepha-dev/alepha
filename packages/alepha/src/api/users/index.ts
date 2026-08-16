import { $module } from "alepha";
import { SessionAudits } from "./audits/SessionAudits.ts";
import { UserAudits } from "./audits/UserAudits.ts";
import { AdminIdentityController } from "./controllers/AdminIdentityController.ts";
import { AdminSessionController } from "./controllers/AdminSessionController.ts";
import { AdminUserController } from "./controllers/AdminUserController.ts";
import { MyAccountController } from "./controllers/MyAccountController.ts";
import { MyAvatarController } from "./controllers/MyAvatarController.ts";
import { MyConnectionController } from "./controllers/MyConnectionController.ts";
import { MyIdentityController } from "./controllers/MyIdentityController.ts";
import { MyPasswordController } from "./controllers/MyPasswordController.ts";
import { MyProfileController } from "./controllers/MyProfileController.ts";
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
import { UserProfileMapper } from "./services/UserProfileMapper.ts";
import { UserService } from "./services/UserService.ts";
import { UserStorage } from "./storage/UserStorage.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/realmAuthSettingsAtom.ts";
export * from "./audits/SessionAudits.ts";
export * from "./audits/UserAudits.ts";
export * from "./controllers/AdminIdentityController.ts";
export * from "./controllers/AdminSessionController.ts";
export * from "./controllers/AdminUserController.ts";
export * from "./controllers/MyAccountController.ts";
export * from "./controllers/MyAvatarController.ts";
export * from "./controllers/MyConnectionController.ts";
export * from "./controllers/MyIdentityController.ts";
export * from "./controllers/MyPasswordController.ts";
export * from "./controllers/MyProfileController.ts";
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
export * from "./schemas/deleteMyAccountBodySchema.ts";
export * from "./schemas/identityQuerySchema.ts";
export * from "./schemas/identityResourceSchema.ts";
export * from "./schemas/loginSchema.ts";
export * from "./schemas/myConnectionSchema.ts";
export * from "./schemas/myIdentitySchema.ts";
export * from "./schemas/myProfileSchema.ts";
export * from "./schemas/passwordResetIntentResponseSchema.ts";
export * from "./schemas/realmConfigSchema.ts";
export * from "./schemas/registerSchema.ts";
export * from "./schemas/registrationIntentResponseSchema.ts";
export * from "./schemas/resetPasswordSchema.ts";
export * from "./schemas/sessionQuerySchema.ts";
export * from "./schemas/sessionResourceSchema.ts";
export * from "./schemas/updateMyProfileBodySchema.ts";
export * from "./schemas/updateUserSchema.ts";
export * from "./schemas/userQuerySchema.ts";
export * from "./schemas/userResourceSchema.ts";
export * from "./services/CredentialService.ts";
export * from "./services/IdentityService.ts";
export * from "./services/RegistrationService.ts";
export * from "./services/SessionCrudService.ts";
export * from "./services/SessionService.ts";
export * from "./services/UsernameSlugger.ts";
export * from "./services/UserProfileMapper.ts";
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
    UserProfileMapper,
    IdentityService,
    UserController,
    AdminUserController,
    AdminSessionController,
    MyPasswordController,
    MySessionController,
    MyProfileController,
    MyIdentityController,
    MyAccountController,
    MyConnectionController,
    AdminIdentityController,
    RealmController,
  ],
  variants: [
    UserJobs,
    UserNotifications,
    UserAudits,
    SessionAudits,
    UserStorage,
    // Registered by `$realm({ features: { avatars: true } })` only — see the
    // class for why the avatar endpoints are not on `MyProfileController`.
    MyAvatarController,
  ],
});

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Emitted by {@link MyAccountController} immediately before an account is
     * deleted, and awaited — nothing is removed until every handler resolves.
     *
     * **Throwing aborts the deletion**, and the thrown error reaches the
     * caller unwrapped, so an application can refuse with its own message and
     * status: `throw new ConflictError("You still own 3 projects")`.
     *
     * This is the seam for data the framework cannot see. `api/users` owns
     * users, identities and sessions; it does not know that an account also
     * owns a project, or that rows it authored inside *other people's* data
     * cascade away with it. An application with foreign keys to `users.id`
     * should subscribe here to clean up or refuse — otherwise it is trusting
     * its own cascade rules, silently.
     */
    "user:delete:before": {
      realm?: string;
      userId: string;
    };
  }
}
