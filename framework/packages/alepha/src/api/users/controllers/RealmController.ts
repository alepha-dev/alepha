import { $inject, z } from "alepha";
import { CaptchaProvider } from "alepha/captcha";
import { $action } from "alepha/server";
import { ServerAuthProvider } from "alepha/server/auth";
import { $etag } from "alepha/server/etag";

import { RealmProvider } from "../providers/RealmProvider.ts";
import {
  publicRealmSettingsSchema,
  type RealmConfig,
  realmConfigSchema,
} from "../schemas/realmConfigSchema.ts";
import { UsernameSlugger } from "../services/UsernameSlugger.ts";

/**
 * Controller for exposing realm configuration.
 */
export class RealmController {
  protected readonly url = "/realms";
  protected readonly group = "realms";
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly serverAuthProvider = $inject(ServerAuthProvider);
  protected readonly captchaProvider = $inject(CaptchaProvider);
  protected readonly usernameSlugger = $inject(UsernameSlugger);

  /**
   * Get realm configuration settings.
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

      // Only what `publicRealmSettingsSchema` lists goes to an anonymous
      // caller, picked here too so the answer does not depend on the
      // serializer dropping the rest.
      const publicSettings = Object.fromEntries(
        Object.keys(publicRealmSettingsSchema.shape)
          .filter((key) => key in settings)
          .map((key) => [key, settings[key as keyof typeof settings]]),
      ) as RealmConfig["settings"];

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
    method: "POST",
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

      // A blocklisted name is not available either; answering "available"
      // only for the registration to refuse it was a contradiction.
      if (await this.usernameSlugger.isBlocked(realmName, body.username)) {
        return { available: false };
      }

      // Case-insensitive AND realm-scoped, matching the
      // `(realm, username COLLATE NOCASE)` unique index. `eq` reported
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
