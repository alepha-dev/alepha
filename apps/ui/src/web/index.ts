import { $module } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.tsx";
import { UiI18n } from "./UiI18n.ts";

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
  services: [AppRouter, UiI18n],
});
