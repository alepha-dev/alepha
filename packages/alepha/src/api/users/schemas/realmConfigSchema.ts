import { type Static, t } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

export const realmConfigSchema = t.object({
  settings: realmAuthSettingsAtom.schema,
  realmName: t.string(),
  authenticationMethods: t.array(authenticationProviderSchema),
});

export type RealmConfig = Static<typeof realmConfigSchema>;
