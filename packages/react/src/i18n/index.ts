import { $module } from "alepha";
import { $dictionary } from "./primitives/$dictionary.ts";
import { I18nProvider } from "./providers/I18nProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export type { LocalizeProps } from "./components/Localize.tsx";
export { default as Localize } from "./components/Localize.tsx";
export * from "./hooks/useI18n.ts";
export * from "./primitives/$dictionary.ts";
export * from "./providers/I18nProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  export interface State {
    "alepha.react.i18n.lang"?: string;
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
  primitives: [$dictionary],
  services: [I18nProvider],
});
