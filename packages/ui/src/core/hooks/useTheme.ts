import { useInject, useStore } from "alepha/react";
import {
  alephaThemeAtom,
  type CurrentAlephaTheme,
} from "../atoms/alephaThemeAtom.ts";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";
import { ThemeProvider } from "../providers/ThemeProvider.ts";

/**
 * Hook to get and set the current theme.
 *
 * Returns a tuple with the current theme and a function to set the theme.
 *
 * ```tsx
 * const [theme, setTheme] = useTheme();
 * ```
 */
export const useTheme = (): [
  AlephaTheme,
  (theme: CurrentAlephaTheme) => void,
] => {
  useStore(alephaThemeAtom);

  const themeProvider = useInject(ThemeProvider);
  const theme = themeProvider.getTheme();
  const setTheme = (theme: CurrentAlephaTheme) => {
    themeProvider.setTheme(theme.index);
  };

  return [theme, setTheme] as const;
};
