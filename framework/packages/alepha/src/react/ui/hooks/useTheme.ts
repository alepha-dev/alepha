import { useUiState } from "./useUiState.ts";

/**
 * Read and update the active theme palette name. UI consumers typically map
 * the value to a class on the document root (e.g. `theme-forest`).
 *
 * @example
 * const { theme, setTheme } = useTheme();
 * setTheme("claude");
 *
 * The server and the hydration pass see `"default"`, never the visitor's
 * cookie (see `useUiState`); the boot script paints the real theme class.
 */
export const useTheme = () => {
  const [state, set] = useUiState();
  const theme = state.theme;

  return {
    theme,
    setTheme: (next: string) => {
      set({ ...state, theme: next });
    },
  };
};
