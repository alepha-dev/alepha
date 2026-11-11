import type { PrimitiveSide } from "alepha";
import { $inject, type Async, createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";

import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Register a dictionary entry for translations.
 *
 * It allows you to define a set of translations for a specific language.
 * Entry can be lazy-loaded, which is useful for large dictionaries or when translations are not needed immediately.
 *
 * @example
 * ```ts
 * import { $dictionary } from "alepha/react/i18n";
 *
 * const Example = () => {
 *   const { tr } = useI18n<App, "en">();
 *   return <div>{tr("hello")}</div>; //
 * }
 *
 * class App {
 *
 *   en = $dictionary({
 *     // { default: { hello: "Hey" } }
 *     lazy: () => import("./translations/en.ts"),
 *   });
 *
 *   home = $page({
 *     path: "/",
 *     component: Example,
 *   })
 * }
 *
 * run(App);
 * ```
 */
export const $dictionary = <T extends Record<string, DictionaryEntry>>(
  options: DictionaryPrimitiveOptions<T>,
): DictionaryPrimitive<T> => {
  return createPrimitive(DictionaryPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One value of a catalog: a plain string, or a variant object.
 *
 * A variant object is chosen by the `count` option of `tr()`, through the
 * `Intl.PluralRules` of the entry's own language, so its names are the CLDR
 * categories (`zero`, `one`, `two`, `few`, `many`, `other`). `other` is
 * required: it is what a count whose category the entry lacks renders, and
 * what a read with no count renders.
 *
 * A variant name carries no dot: the key scanners of `alepha i18n check` read
 * a quoted, dotted name as a catalog key.
 *
 * @example
 * ```ts
 * const en = {
 *   "tickets.count": { one: "{count} ticket", other: "{count} tickets" },
 * } satisfies Record<string, DictionaryEntry>;
 *
 * tr("tickets.count", { count: 3 }); // "3 tickets"
 * ```
 */
export type DictionaryEntry = string | DictionaryVariants;

/**
 * The variant object of a {@link DictionaryEntry}: `other` plus any variant.
 */
export type DictionaryVariants = {
  other: string;
  [variant: string]: string;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface DictionaryPrimitiveOptions<
  T extends Record<string, DictionaryEntry>,
> {
  lang?: string;
  name?: string;
  lazy: () => Async<{ default: T }>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class DictionaryPrimitive<
  T extends Record<string, DictionaryEntry>,
> extends Primitive<DictionaryPrimitiveOptions<T>> {
  /**
   * `boot` for the pure controller rule: registers its translations at init.
   */
  public static override readonly side: PrimitiveSide = "boot";

  protected provider = $inject(I18nProvider);
  protected onInit() {
    this.provider.registry.push({
      target: this.config.service.name,
      name: this.options.name ?? this.config.propertyKey,
      lang: this.options.lang ?? this.config.propertyKey,
      loader: async () => {
        const mod = await this.options.lazy();
        return mod.default;
      },
      translations: {},
    });
  }
}

$dictionary[KIND] = DictionaryPrimitive;
