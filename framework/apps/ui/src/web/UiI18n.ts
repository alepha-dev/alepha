import { $dictionary } from "alepha/react/i18n";

/**
 * English only, and deliberately thin.
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
      },
    }),
  });
}
