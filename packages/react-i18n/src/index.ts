import { $module } from "@alepha/core";
import { $dictionary } from "./descriptors/$dictionary.ts";
import { I18nProvider } from "./providers/I18nProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$dictionary.ts";
export * from "./hooks/useI18n.ts";
export * from "./providers/I18nProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
  export interface State {
    "react.i18n.lang"?: string;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Add i18n support to your Alepha React application. SSR and CSR compatible.
 *
 * It supports lazy loading of translations and provides a context to access the current language.
 *
 * @module alepha.react.i18n
 */
export const AlephaReactI18n = $module({
  name: "alepha.react.i18n",
  descriptors: [$dictionary],
  services: [I18nProvider],
});
