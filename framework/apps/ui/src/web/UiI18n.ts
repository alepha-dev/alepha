import { $dictionary } from "alepha/react/i18n";

/**
 * English only for its strings, and deliberately thin.
 *
 * `AlephaReactI18n` is not optional for `@alepha/ui` - the components resolve
 * their built-in strings through the global `tr()` lookup, and without the
 * module registered SSR renders fine and hydration dies. What IS optional is
 * overriding those strings, and a showcase has no reason to: the point is to
 * see the components' own defaults.
 */
export class UiI18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "language.en": "English",
        "language.ar": "العربية",
      },
    }),
  });

  /**
   * Arabic, declared with no string of its own: every key falls back to
   * English. The showcase needs it for what a language brings besides text,
   * `<html dir="rtl">` and its formats, and a request's language is only ever
   * a declared one (`e2e/rtl.spec.ts` asks for it with a `lang` cookie).
   */
  ar = $dictionary({
    lazy: async () => ({ default: {} }),
  });
}
