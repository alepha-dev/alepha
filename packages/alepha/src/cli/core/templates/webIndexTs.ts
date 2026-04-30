export interface WebIndexTsOptions {
  appName?: string;
  /**
   * SaaS bundle: auth pages need `useAuth()` (ReactAuth) which lives in the
   * `alepha.react.auth` module. Importing it here registers ReactAuth in the
   * container so the auth-* registry components can inject it.
   */
  saas?: boolean;
}

export const webIndexTs = (options: WebIndexTsOptions = {}) => {
  const { appName = "app", saas = false } = options;

  if (saas) {
    return `
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "${appName}.web",
  services: [AppRouter],
  imports: [AlephaReactAuth, AlephaReactI18n],
});
`.trim();
  }

  return `
import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "${appName}.web",
  services: [AppRouter],
});
`.trim();
};
