import { $module } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.ts";

/**
 * The browser half: one IDE-shaped shell over the two routes.
 *
 * ⚠️ `AlephaReactI18n` is required even though Loom registers no catalogue:
 * every `@alepha/ui` string goes through `useI18n()`, and without the module
 * the server renders fine and only hydration dies.
 *
 * @module loom.web
 */
export const LoomWeb = $module({
  name: "loom.web",
  imports: [AlephaReactI18n, AlephaReactUi],
  services: [AppRouter],
});
