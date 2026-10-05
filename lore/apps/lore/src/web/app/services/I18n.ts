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
  /**
   * ⚠️ The plain `lazy: () => import(...)` form, on purpose. `check:i18n`
   * finds a dictionary's key file by reading that form, and the async body
   * this used to have (merging `@alepha/ui`'s French here) hid `fr.ts` from
   * it: the file was scanned as ordinary source, and every key it declares
   * counted as "used". The merge lives in `fr.ts` instead.
   */
  fr = $dictionary({ lazy: () => import("../../locales/fr.ts") });
}
