import { useInject, useStore } from "@alepha/react";
import {
  type Theme,
  ThemeService,
  themeAtom,
} from "../services/ThemeService.ts";

export const useTheme = () => {
  const [, setTheme] = useStore(themeAtom);

  const themeService = useInject(ThemeService);

  const applyTheme = (theme: Theme) => {
    if (typeof document === "undefined") return;

    document.documentElement.removeAttribute("data-theme");

    if (theme.id !== "default") {
      document.documentElement.setAttribute("data-theme", theme.id);
    }

    themeService.setTheme({ ...theme });
    setTheme({ ...theme });
  };

  return [themeService.getTheme(), applyTheme] as const;
};
