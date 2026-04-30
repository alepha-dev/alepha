export interface ApiIndexTsOptions {
  appName?: string;
  /**
   * Include `AlephaApiUsers` (realms, sessions, registration, identities,
   * password reset, email verification, admin endpoints) plus the local
   * `RealmProvider` that declares `$realm({ ... })`.
   */
  saas?: boolean;
}

export const apiIndexTs = (options: ApiIndexTsOptions = {}) => {
  const { appName = "app", saas = false } = options;

  if (saas) {
    return `
import { $module } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { HelloController } from "./controllers/HelloController.ts";
import { RealmProvider } from "./providers/RealmProvider.ts";

export const ApiModule = $module({
  name: "${appName}.api",
  services: [HelloController, RealmProvider],
  imports: [AlephaApiUsers],
});
`.trim();
  }

  return `
import { $module } from "alepha";
import { HelloController } from "./controllers/HelloController.ts";

export const ApiModule = $module({
  name: "${appName}.api",
  services: [HelloController],
});
`.trim();
};
