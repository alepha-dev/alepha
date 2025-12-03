import { useInject, useStore } from "@alepha/react";
import {
  type Theme,
  ThemeService,
  themeAtom,
} from "../services/ThemeService.ts";

export const useTheme = () => {
  useStore(themeAtom);

  const themeService = useInject(ThemeService);

  const applyTheme = (theme: Theme) => {
    themeService.setTheme({ ...theme });
  };

  return [themeService.getTheme(), applyTheme] as const;
};
