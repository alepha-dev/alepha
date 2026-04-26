import { useStore } from "alepha/react";
import { uiAtom } from "../atoms/uiAtom.ts";

/**
 * Read and update the active theme palette name. UI consumers typically map
 * the value to a class on the document root (e.g. `theme-claude`).
 *
 * @example
 * const { theme, setTheme } = useTheme();
 * setTheme("claude");
 */
export const useTheme = () => {
  const [state, set] = useStore(uiAtom);
  const theme = state?.theme ?? "default";

  return {
    theme,
    setTheme: (next: string) => {
      set({ ...(state ?? uiAtom.options.default!), theme: next });
    },
  };
};
