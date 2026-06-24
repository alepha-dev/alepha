import { $inject, z } from "alepha";
import { CaptchaProvider } from "alepha/captcha";
import { $action } from "alepha/server";
import { ServerAuthProvider } from "alepha/server/auth";
import { $etag } from "alepha/server/etag";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { realmConfigSchema } from "../schemas/realmConfigSchema.ts";

/**
 * Controller for exposing realm configuration.
 * Uses $route instead of $action to keep endpoints hidden from API documentation.
 */
export class RealmController {
  protected readonly url = "/realms";
  protected readonly group = "realms";
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly serverAuthProvider = $inject(ServerAuthProvider);
  protected readonly captchaProvider = $inject(CaptchaProvider);

  /**
   * Get realm configuration settings.
   * This endpoint is not exposed in the API documentation.
   */
  public readonly getRealmConfig = $action({
    group: this.group,
    method: "GET",
    path: `${this.url}/config`,
    use: [$etag()],
    schema: {
      query: z.object({
        realmName: z.string().optional(),
      }),
      response: realmConfigSchema,
    },
    handler: async ({ query }) => {
      const realm = this.realmProvider.getRealm(query.realmName);
      const settings = await realm.getSettings();
      const realmName = realm.name;

      const authenticationMethods =
        this.serverAuthProvider.getAuthenticationProviders({
          realmName,
        });

      return {
        settings,
        realmName,
        authenticationMethods,
        captchaSiteKey: settings.captchaRequired
          ? this.captchaProvider.getSiteKey()
          : undefined,
      };
    },
  });

  public readonly checkUsernameAvailability = $action({
    group: this.group,
    path: `${this.url}/check-username`,
    schema: {
      query: z.object({
        realmName: z.text().optional(),
      }),
      body: z.object({
        username: z.text(),
      }),
      response: z.object({
        available: z.boolean(),
      }),
    },
    handler: async ({ query, body }) => {
      const realmName = query.realmName;
      const userRepository = this.realmProvider.userRepository(realmName);

      const existingUser = await userRepository.findOne({
        where: { username: { eq: body.username } },
      });

      return {
        available: !existingUser,
      };
    },
  });
}
