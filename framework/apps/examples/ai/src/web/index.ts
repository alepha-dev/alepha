import { $module } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";

import { AppRouter } from "./AppRouter.tsx";

/**
 * The browser half: one page and the chat drawer.
 *
 * `AlephaReactI18n` is not optional even with no catalogue: every
 * `@alepha/ui` string goes through `useI18n()`.
 *
 * @module ai.web
 */
export const AiExampleWeb = $module({
  name: "ai.web",
  imports: [AlephaReactI18n],
  services: [AppRouter],
});
