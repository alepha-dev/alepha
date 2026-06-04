import { type Static, t } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

export const realmConfigSchema = t.object({
  settings: realmAuthSettingsAtom.schema,
  realmName: t.string(),
  authenticationMethods: t.array(authenticationProviderSchema),
  captchaSiteKey: t.optional(
    t.string({
      description:
        "Public site key for the captcha widget (when settings.captchaRequired is true)",
    }),
  ),
  /**
   * Federated (broker) social login. When present, the login UI renders one
   * button per provider linking to `{brokerUrl}/auth/federated/start`.
   */
  federated: t.optional(
    t.object({
      brokerUrl: t.string({
        description: "Broker origin that performs the OIDC dance.",
      }),
      providers: t.array(t.union([t.const("google"), t.const("apple")]), {
        description: "Federated providers to surface as login buttons.",
      }),
    }),
  ),
});

export type RealmConfig = Static<typeof realmConfigSchema>;
