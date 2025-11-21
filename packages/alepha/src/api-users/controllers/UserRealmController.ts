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
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly serverAuthProvider = $inject(ServerAuthProvider);

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
      const realmName = query.userRealmName || "default";
      const settings = this.userRealmProvider.getRealmSettings(realmName);

      return {
        settings,
        realmName,
        authenticationMethods:
          this.serverAuthProvider.getAuthenticationProviders({
            realmName,
          }),
      };
    },
  });
}
