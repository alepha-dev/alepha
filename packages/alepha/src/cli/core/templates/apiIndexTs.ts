export interface ApiIndexTsOptions {
  appName?: string;

  /**
   * Mount the identity backend the saas web routers talk to.
   *
   * Only two modules, because `$realm` is the switchboard for the rest:
   * `features.apiKeys` registers `AlephaApiKeys`, `features.jobs` registers
   * `UserJobs`, `features.notifications` registers `UserNotifications` plus
   * `AlephaApiVerification`. Listing those here as well would give a project
   * two places to turn the same feature on.
   */
  saas?: boolean;
}

export const apiIndexTs = (options: ApiIndexTsOptions = {}) => {
  const { appName = "app", saas = false } = options;

  if (!saas) {
    return (
      `
import { $module } from "alepha";
import { HelloController } from "./controllers/HelloController.ts";

export const ApiModule = $module({
  name: "${appName}.api",
  services: [HelloController],
});
`.trim() + "\n"
    );
  }

  return (
    `
import { $module } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaOrm } from "alepha/orm";
import { HelloController } from "./controllers/HelloController.ts";
import { Realm } from "./Realm.ts";

/**
 * Everything the identity surface needs is turned on from Realm's \`features\`
 * — see that file. AlephaOrm needs DATABASE_URL; in development
 * DATABASE_SYNC defaults to true, so the schema is pushed for you and there
 * is nothing to generate before the first \`alepha dev\`.
 *
 * Before deploying, freeze the schema: \`alepha db migrations create\`.
 */
export const ApiModule = $module({
  name: "${appName}.api",
  imports: [AlephaOrm, AlephaApiUsers],
  services: [Realm, HelloController],
});
`.trim() + "\n"
  );
};
