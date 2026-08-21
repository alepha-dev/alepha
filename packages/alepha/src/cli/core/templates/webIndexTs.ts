export interface WebIndexTsOptions {
  appName?: string;

  /**
   * Mount the `@alepha/ui` identity surface: `AuthRouter` (`/auth/*`),
   * `AccountRouter` (`/account/*`) and `AdminRouter` (`/admin/*`).
   *
   * Neither router options atom is set here. Both default to `{}`, every
   * field is optional, and the two defaults that would otherwise need
   * spelling out already match what this scaffold mounts —
   * `homeRouteName: "home"` is `AppRouter.home`, and `loginRouteName:
   * "login"` is the page `AuthRouter` itself declares. An application that
   * wants its own chrome calls `alepha.set(adminRouterOptionsAtom, …)` from
   * both entry points; a fresh project has no chrome to supply.
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
import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
import { AuthRouter } from "@alepha/ui/components/auth/auth-router";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.ts";

/**
 * The three routers mount their own pages — /auth/*, /account/* and /admin/*
 * — so there is nothing to declare beyond listing them.
 *
 * Each page hides itself when the action behind it is missing from
 * /api/_links, so deleting a module from ApiModule removes its screens too
 * rather than leaving a link to a 404. Drop a router from this list when you
 * want the whole surface gone.
 */
export const WebModule = $module({
  name: "${appName}.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  services: [AppRouter, AuthRouter, AccountRouter, AdminRouter],
});
`.trim() + "\n"
  );
};
