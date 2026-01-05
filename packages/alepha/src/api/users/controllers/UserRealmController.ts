import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { ServerAuthProvider } from "alepha/server/auth";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import { userRealmConfigSchema } from "../schemas/userRealmConfigSchema.ts";

/**
 * Controller for exposing realm configuration.
 * Uses $route instead of $action to keep endpoints hidden from API documentation.
 */
export class UserRealmController {
  protected readonly url = "/realms";
  protected readonly group = "realms";
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly serverAuthProvider = $inject(ServerAuthProvider);

  /**
   * Get realm configuration settings.
   * This endpoint is not exposed in the API documentation.
   */
  public readonly getRealmConfig = $action({
    group: this.group,
    method: "GET",
    path: `${this.url}/config`,
    secure: false,
    cache: {
      etag: true,
      control: {
        maxAge: [24, "hours"],
      },
    },
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
    group: this.group,
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
}
