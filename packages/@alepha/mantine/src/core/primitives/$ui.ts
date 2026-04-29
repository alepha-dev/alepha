import { $context } from "alepha";
import {
  type AlephaThemeListAtom,
  alephaThemeListAtom,
} from "../atoms/alephaThemeListAtom.ts";
import { UiRouter } from "../UiRouter.ts";

/**
 * Convenience function to configure and inject the UiRouter.
 */
export const $ui = (options: { themes?: AlephaThemeListAtom } = {}) => {
  const { alepha } = $context();
  if (options.themes) {
    alepha.store.set(alephaThemeListAtom, options.themes);
  }
  return alepha.inject(UiRouter); // Inject as singleton ?
};
