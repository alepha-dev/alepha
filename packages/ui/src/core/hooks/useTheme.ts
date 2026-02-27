import { useInject, useStore } from "alepha/react";
import {
  alephaThemeAtom,
  type CurrentAlephaTheme,
} from "../atoms/alephaThemeAtom.ts";
import {
  type AlephaThemeOverrides,
  alephaThemeOverridesAtom,
} from "../atoms/alephaThemeOverridesAtom.ts";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";
import { ThemeProvider } from "../providers/ThemeProvider.ts";

export interface ThemeExpert {
  overrides: AlephaThemeOverrides;
  setOverrides: (overrides: AlephaThemeOverrides) => void;
  resetOverrides: () => void;
}

/**
 * Hook to get and set the current theme.
 *
 * Returns a tuple with the current theme, a function to set the theme,
 * and expert mode controls for fine-grained customization.
 *
 * ```tsx
 * const [theme, setTheme, expert] = useTheme();
 * ```
 */
export const useTheme = (): [
  AlephaTheme,
  (theme: CurrentAlephaTheme) => void,
  ThemeExpert,
] => {
  useStore(alephaThemeAtom);
  useStore(alephaThemeOverridesAtom);

  const themeProvider = useInject(ThemeProvider);
  const theme = themeProvider.getTheme();
  const setTheme = (theme: CurrentAlephaTheme) => {
    themeProvider.setTheme(theme.index);
  };

  const expert: ThemeExpert = {
    overrides: themeProvider.getThemeOverrides(),
    setOverrides: (overrides: AlephaThemeOverrides) => {
      themeProvider.setThemeOverrides(overrides);
    },
    resetOverrides: () => {
      themeProvider.resetThemeOverrides();
    },
  };

  return [theme, setTheme, expert] as const;
};
