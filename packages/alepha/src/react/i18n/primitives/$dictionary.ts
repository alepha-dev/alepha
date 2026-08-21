import { $inject, type Async, createPrimitive, KIND, Primitive } from "alepha";

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
export const $dictionary = <T extends Record<string, string>>(
  options: DictionaryPrimitiveOptions<T>,
): DictionaryPrimitive<T> => {
  return createPrimitive(DictionaryPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface DictionaryPrimitiveOptions<T extends Record<string, string>> {
  lang?: string;
  name?: string;
  lazy: () => Async<{ default: T }>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class DictionaryPrimitive<
  T extends Record<string, string>,
> extends Primitive<DictionaryPrimitiveOptions<T>> {
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
