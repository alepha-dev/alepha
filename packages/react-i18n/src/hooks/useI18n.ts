import { useInject, useStore } from "@alepha/react";
import type { DictionaryDescriptor } from "../descriptors/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Hook to access the i18n service.
 */
export const useI18n = <
	S extends object,
	K extends keyof ServiceDictionary<S>,
>() => {
	const i18n = useInject(I18nProvider);
	const [lang = i18n.options.fallbackLang] = useStore("react.i18n.lang");

	return {
		lang,
		setLang: (lang: string) => i18n.setLang(lang),
		tr: (key: keyof ServiceDictionary<S>[K]) => i18n.translate(key as string),
	};
};

type ServiceDictionary<T extends object> = {
	[K in keyof T]: T[K] extends DictionaryDescriptor<infer U> ? U : never;
};
