import { type Static, z } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

export const realmConfigSchema = z.object({
  settings: realmAuthSettingsAtom.schema,
  realmName: z.string(),
  authenticationMethods: z.array(authenticationProviderSchema),
  captchaSiteKey: z
    .string()
    .describe(
      "Public site key for the captcha widget (when settings.captchaRequired is true)",
    )
    .optional(),
});

export type RealmConfig = Static<typeof realmConfigSchema>;
