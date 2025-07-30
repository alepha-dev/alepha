import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import { I18nProvider } from "../providers/I18nProvider.ts";

export const $dictionary = <T extends Record<string, string>>(
	options: DictionaryDescriptorOptions<T>,
): DictionaryDescriptor<T> => {
	return createDescriptor(DictionaryDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface DictionaryDescriptorOptions<T extends Record<string, string>> {
	lang?: string;
	name?: string;
	lazy: () => Promise<{ default: T }>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class DictionaryDescriptor<
	T extends Record<string, string>,
> extends Descriptor<DictionaryDescriptorOptions<T>> {
	protected provider = $inject(I18nProvider);
	protected onInit() {
		this.provider.registry.push({
			name: this.options.name ?? this.config.propertyKey,
			lang: this.options.lang ?? this.config.propertyKey,
			loader: () => this.options.lazy().then((it) => it.default),
			translations: {},
		});
	}
}

$dictionary[KIND] = DictionaryDescriptor;
