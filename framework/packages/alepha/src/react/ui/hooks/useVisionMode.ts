import { useUiState } from "./useUiState.ts";

export type VisionMode = "normal" | "cvd";

/**
 * Read and update the vision mode: `"cvd"` (colour vision deficiency) turns
 * on the colour-blind-safe palette, `"normal"` turns it off. Independent of
 * the color mode and of the theme palette, so it combines with both.
 *
 * The preference lives in the `alepha-ui` cookie with the others. What it
 * changes is CSS only: the class `cvd` on `<html>` (and `data-vision`, always
 * set), which a stylesheet keys its token overrides on, `.cvd` for light and
 * `.cvd.dark` for dark. `@alepha/ui` ships those blocks for its own tokens.
 *
 * The server and the hydration pass see `"normal"`, never the visitor's
 * cookie (see `useUiState`); the boot script paints the `cvd` class before
 * that, and `ColorScheme` keeps it in step afterwards.
 *
 * @example
 * const { vision, setVision, toggle } = useVisionMode();
 * setVision("cvd");
 */
export const useVisionMode = () => {
  const [state, set] = useUiState();
  const vision: VisionMode = state.vision === "cvd" ? "cvd" : "normal";

  const setVision = (next: VisionMode) => {
    set({ ...state, vision: next });
  };

  return {
    vision,
    setVision,
    toggle: () => setVision(vision === "cvd" ? "normal" : "cvd"),
  };
};
