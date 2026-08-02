import { type Infer, z } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

/**
 * Public projection of the realm auth settings. `adminEmails` / `adminUsernames`
 * are the list of accounts auto-promoted to admin and must never be exposed on
 * the unauthenticated `/realms/config` endpoint.
 */
export const publicRealmSettingsSchema = realmAuthSettingsAtom.schema.omit({
  adminEmails: true,
  adminUsernames: true,
});

export const realmConfigSchema = z.object({
  settings: publicRealmSettingsSchema,
  realmName: z.string(),
  authenticationMethods: z.array(authenticationProviderSchema),
  captchaSiteKey: z
    .string()
    .describe(
      "Public site key for the captcha widget (when settings.captchaRequired is true)",
    )
    .optional(),
});

export type RealmConfig = Infer<typeof realmConfigSchema>;
