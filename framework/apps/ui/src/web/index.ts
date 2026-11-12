import { $module } from "alepha";
import { PasskeyClient } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.tsx";
import { ShowcaseSettings } from "./ShowcaseSettings.ts";
import { UiI18n } from "./UiI18n.ts";
import { UiThemes } from "./UiThemes.ts";

/**
 * No `AlephaReactAuth`, no `AuthRouter`, no `AdminRouter` yet.
 *
 * The auth and admin blocks arrive with the fixtures that feed them (phase 2);
 * mounting `AdminRouter` before its actions exist in `ShowcaseFixtures` would
 * put twelve pages in the nav that all render empty.
 */
export const UiWeb = $module({
  name: "ui.web",
  imports: [AlephaReactI18n, AlephaReactUi],
  /**
   * `PasskeyClient` because the Sign in and Security showcases render the
   * passkey button and card, which inject it: with its module never
   * registered, the locked container refused it and both pages failed to
   * render. Listing the class brings its module in at boot.
   */
  services: [AppRouter, ShowcaseSettings, UiI18n, UiThemes, PasskeyClient],
});
