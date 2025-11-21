import { type Static, t } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";
import { loginSettingsSchema } from "./loginSettingsSchema.ts";

export const userRealmConfigSchema = t.object({
  settings: t.optional(loginSettingsSchema),
  realmName: t.string(),
  authenticationMethods: t.array(authenticationProviderSchema),
});

export type UserRealmConfig = Static<typeof userRealmConfigSchema>;
