import { $inject, t } from "alepha";
import { CryptoProvider } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";
import { ServerAuthProvider } from "alepha/server/auth";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import { registerQuerySchema } from "../schemas/registerQuerySchema.ts";
import { registerRequestSchema } from "../schemas/registerRequestSchema.ts";
import { registerResponseSchema } from "../schemas/registerResponseSchema.ts";
import { userRealmConfigSchema } from "../schemas/userRealmConfigSchema.ts";

/**
 * Controller for exposing realm configuration.
 * Uses $route instead of $action to keep endpoints hidden from API documentation.
 */
export class UserRealmController {
  protected readonly url = "/realms";
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly serverAuthProvider = $inject(ServerAuthProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);

  /**
   * Get realm configuration settings.
   * This endpoint is not exposed in the API documentation.
   */
  public readonly getRealmConfig = $action({
    method: "GET",
    path: `${this.url}/config`,
    secure: false,
    schema: {
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: userRealmConfigSchema,
    },
    handler: ({ query }) => {
      const { name: realmName, settings } = this.userRealmProvider.getRealm(
        query.userRealmName,
      );

      const authenticationMethods =
        this.serverAuthProvider.getAuthenticationProviders({
          realmName,
        });

      return {
        settings,
        realmName,
        authenticationMethods,
      };
    },
  });

  public readonly checkUsernameAvailability = $action({
    path: `${this.url}/check-username`,
    secure: false,
    schema: {
      query: t.object({
        userRealmName: t.optional(t.text()),
      }),
      body: t.object({
        username: t.text(),
      }),
      response: t.object({
        available: t.boolean(),
      }),
    },
    handler: async ({ query, body }) => {
      const realmName = query.userRealmName;
      const userRepository = this.userRealmProvider.userRepository(realmName);

      const existingUser = await userRepository
        .findOne({ where: { username: { eq: body.username } } })
        .catch(() => undefined);

      return {
        available: !existingUser,
      };
    },
  });

  /**
   * Register a new user account with credentials.
   * Creates a user and associated credentials identity.
   */
  public readonly register = $action({
    method: "POST",
    path: `${this.url}/register`,
    secure: false,
    schema: {
      body: registerRequestSchema,
      query: registerQuerySchema,
      response: registerResponseSchema,
    },
    handler: async ({ body, query }) => {
      const realmName = query.userRealmName;
      const realmSettings = this.userRealmProvider.getRealm(realmName).settings;

      // Check if registration is allowed
      if (realmSettings?.registrationAllowed === false) {
        throw new BadRequestError("Registration is not allowed");
      }

      // validate required fields based on settings
      if (realmSettings?.usernameRequired && !body.username) {
        throw new BadRequestError("Username is required");
      }

      if (realmSettings?.emailRequired !== false && !body.email) {
        throw new BadRequestError("Email is required");
      }

      if (realmSettings?.phoneRequired && !body.phoneNumber) {
        throw new BadRequestError("Phone number is required");
      }

      // Get repositories for this realm
      const userRepository = this.userRealmProvider.userRepository(realmName);
      const identityRepository =
        this.userRealmProvider.identityRepository(realmName);

      // Check for existing user based on provided unique fields
      if (body.username) {
        const existingUser = await userRepository
          .findOne({ where: { username: { eq: body.username } } })
          .catch(() => undefined);
        if (existingUser) {
          throw new BadRequestError("User with this username already exists");
        }
      }

      if (body.email) {
        const existingUser = await userRepository
          .findOne({ where: { email: { eq: body.email } } })
          .catch(() => undefined);
        if (existingUser) {
          throw new BadRequestError("User with this email already exists");
        }
      }

      if (body.phoneNumber) {
        const existingUser = await userRepository
          .findOne({ where: { phoneNumber: { eq: body.phoneNumber } } })
          .catch(() => undefined);
        if (existingUser) {
          throw new BadRequestError(
            "User with this phone number already exists",
          );
        }
      }

      // create the user
      const user = await userRepository.create({
        username: body.username,
        email: body.email,
        phoneNumber: body.phoneNumber,
        firstName: body.firstName,
        lastName: body.lastName,
        picture: body.picture,
        roles: ["user"], // Default role
        enabled: true,
        emailVerified: false,
      });

      // hash the password
      const hashedPassword = await this.cryptoProvider.hashPassword(
        body.password,
      );

      // create the credentials identity
      await identityRepository.create({
        userId: user.id,
        provider: "credentials",
        password: hashedPassword,
      });

      return {
        user,
      };
    },
  });
}
