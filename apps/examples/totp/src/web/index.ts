import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { accountRouterOptionsAtom } from "@alepha/ui/components/account/account-router-options";
import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
import { AuthRouter } from "@alepha/ui/components/auth/auth-router";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.tsx";

/**
 * The browser half.
 *
 * The service list is the feature list, and none of it is written here:
 *
 * - `AuthRouter` mounts `/auth/login` and `/auth/register`, and carries the
 *   second-factor step. That step is one screen shared by both verifiers,
 *   which is why nothing about it is TOTP-specific.
 * - `AccountRouter` mounts `/account/*`. Its Security page is where enrollment,
 *   the recovery codes and the turn-off flow live.
 * - `AdminRouter` mounts `/admin` and its built-in pages, including the user
 *   detail Security tab that clears a locked-out user's second factor.
 *
 * ⚠️ `AlephaReactI18n` is **not** optional, even for a single-language app that
 * registers no catalogue at all. It reads as optional: every string in
 * `@alepha/ui` is a `tr("key", { default: "English" })`, which looks like it
 * falls back on its own. It does not. `useI18n()` resolves a provider out of
 * the container, so without the module the first component to call it throws
 * `ContainerLockedError: Module 'alepha.react.i18n' is not registered`.
 *
 * The failure is worth knowing because of where it lands: the server renders
 * fine, so the page arrives looking correct and only hydration dies. Nothing
 * but a browser console says so.
 *
 * No dictionary is registered, so every string is its English default. That
 * part of the original assumption was right.
 *
 * @module totp.web
 */
export const TotpWeb = $module({
  name: "totp.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  services: [AppRouter, AuthRouter, AccountRouter, AdminRouter],
  register: (alepha) => {
    /*
     * No second header on the account pages.
     *
     * `AccountRouter` ships one for an area mounted standalone at the root.
     * This app adopts its layout into `AppRouter.layout`, which already renders
     * the theme and account controls, so the default would paint a second row
     * of the same buttons under the first. `null` is the documented value for
     * that case, and `AccountLayout` tests `!== undefined` precisely so it can
     * tell "nested, drop the bar" from "not configured".
     *
     * Set in `register` rather than in `main.*.ts` because this value carries
     * no JSX, so one call covers both containers.
     */
    alepha.store.set(accountRouterOptionsAtom, { header: null });
  },
});
