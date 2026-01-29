import { useInject, useStore } from "alepha/react";
import type { DictionaryPrimitive } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Hook to access the i18n service.
 */
export const useI18n = <
  S extends object,
  K extends keyof ServiceDictionary<S>,
>(): I18nProvider<S, K> => {
  useStore("alepha.react.i18n.lang");
  return useInject(I18nProvider<S, K>);
};

export type ServiceDictionary<T extends object> = {
  [K in keyof T]: T[K] extends DictionaryPrimitive<infer U> ? U : never;
};
