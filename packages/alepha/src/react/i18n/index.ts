import { $module } from "alepha";
import { $dictionary } from "./primitives/$dictionary.ts";
import { I18nProvider } from "./providers/I18nProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export type { LocalizeProps } from "./components/Localize.tsx";
export { default as Localize } from "./components/Localize.tsx";
export type { TranslateProps } from "./components/Translate.tsx";
export { default as Translate, Tr } from "./components/Translate.tsx";
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
 * Multi-language support.
 *
 * **Features:**
 * - Translation loading
 * - Locale detection
 * - Positional interpolation (`$1`, `$2`) and localized dates/numbers
 *
 * @module alepha.react.i18n
 */
export const AlephaReactI18n = $module({
  name: "alepha.react.i18n",
  primitives: [$dictionary],
  services: [I18nProvider],
});
