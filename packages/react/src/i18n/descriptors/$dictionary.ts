import { $inject, Async, createDescriptor, Descriptor, KIND } from "alepha";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Register a dictionary entry for translations.
 *
 * It allows you to define a set of translations for a specific language.
 * Entry can be lazy-loaded, which is useful for large dictionaries or when translations are not needed immediately.
 *
 * @example
 * ```ts
 * import { $dictionary } from "@alepha/react/i18n";
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
  options: DictionaryDescriptorOptions<T>,
): DictionaryDescriptor<T> => {
  return createDescriptor(DictionaryDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface DictionaryDescriptorOptions<T extends Record<string, string>> {
  lang?: string;
  name?: string;
  lazy: () => Async<{ default: T }>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class DictionaryDescriptor<
  T extends Record<string, string>,
> extends Descriptor<DictionaryDescriptorOptions<T>> {
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

$dictionary[KIND] = DictionaryDescriptor;
