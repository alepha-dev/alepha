import { $dictionary } from "alepha/react/i18n";

/**
 * Translation dictionaries, one dynamic import per locale so each ~1040-entry
 * table is its own chunk and only the active language is fetched. Previously
 * both `en` and `fr` shipped on init even though only one is ever shown.
 *
 * `en` is the canonical key source consumed by `useI18n<I18n, "en">()`, so its
 * shape still drives type-safe `tr(...)` keys across the app.
 */
export class I18n {
  en = $dictionary({ lazy: () => import("../../locales/en.ts") });
  fr = $dictionary({ lazy: () => import("../../locales/fr.ts") });
}
