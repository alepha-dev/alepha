export interface WebIndexTsOptions {
  appName?: string;

  /**
   * Mount the `@alepha/ui` identity surface: `AuthRouter` (`/auth/*`),
   * `AccountDialog` (the account, a dialog over the page, opened from the
   * user menu or `?account=<section>`) and `AdminRouter` (`/admin/*`).
   *
   * No options atom is set here. Both default to `{}`, every field is
   * optional, and the defaults already match what this scaffold mounts:
   * `homeRouteName: "home"` is `AppRouter.home`, and `loginRouteName:
   * "login"` is the page `AuthRouter` itself declares. A fresh project has no
   * chrome to supply.
   */
  saas?: boolean;
}

export const webIndexTs = (options: WebIndexTsOptions = {}) => {
  const { appName = "app", saas = false } = options;

  if (!saas) {
    return (
      `
import { $module } from "alepha";

import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "${appName}.web",
  services: [AppRouter],
});
`.trim() + "\n"
    );
  }

  return (
    `
import { AccountDialog } from "@alepha/ui/account";
import { AdminRouter } from "@alepha/ui/admin";
import { AuthRouter } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.ts";

/**
 * The two routers mount their own pages (/auth/* and /admin/*), and
 * AccountDialog declares the account dialog the user menu opens, drawn by the
 * layout's DialogProvider: there is nothing to declare beyond listing them.
 *
 * Each page and section hides itself when the action behind it is missing
 * from /api/_links, so deleting a module from ApiModule removes its screens
 * too rather than leaving a link to a 404. Drop one from this list when you
 * want the whole surface gone.
 */
export const WebModule = $module({
  name: "${appName}.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  services: [AppRouter, AuthRouter, AccountDialog, AdminRouter],
});
`.trim() + "\n"
  );
};
