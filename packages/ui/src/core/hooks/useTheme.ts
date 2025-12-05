import { useInject, useStore } from "@alepha/react";
import {
  type AlephaTheme,
  mantineThemeAtom,
  type Theme,
  ThemeProvider,
} from "../providers/ThemeProvider.ts";

export const useTheme = () => {
  useStore(mantineThemeAtom);

  const themeService = useInject(ThemeProvider);
  const currentTheme = themeService.getTheme();

  // Find the full theme object from the themes array
  const fullTheme =
    themeService.themes.find((t) => t.id === currentTheme.id) ??
    themeService.themes[0];

  const applyTheme = (theme: Theme | AlephaTheme) => {
    themeService.setTheme({ id: theme.id });
  };

  return [fullTheme, applyTheme] as const;
};
