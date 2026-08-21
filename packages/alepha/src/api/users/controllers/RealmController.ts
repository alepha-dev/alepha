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

      // Never leak the privileged-account allowlist to anonymous callers.
      const { adminEmails, adminUsernames, ...publicSettings } = settings;

      return {
        settings: publicSettings,
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

      // Case-insensitive AND realm-scoped, matching the
      // `(realm, LOWER(username))` unique index. `eq` reported
      // `available: true` for "Admin" when "admin" was taken (the
      // registration then 409'd), and it searched every realm.
      const realm = this.realmProvider.getRealm(realmName);
      const existingUser = await userRepository.findOne({
        where: {
          realm: { eq: realm.name },
          username: { eqInsensitive: body.username },
        },
      });

      return {
        available: !existingUser,
      };
    },
  });
}
