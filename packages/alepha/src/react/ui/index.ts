import { $module } from "alepha";
import type { UiState } from "./atoms/uiAtom.ts";
import type { UiThemeList } from "./atoms/uiThemeListAtom.ts";
import { uiThemeListAtom } from "./atoms/uiThemeListAtom.ts";
import { UiPersistence } from "./services/UiPersistence.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/uiAtom.ts";
export * from "./atoms/uiThemeListAtom.ts";
export * from "./components/ColorScheme.tsx";
export * from "./hooks/useColorMode.ts";
export * from "./hooks/useSidebarState.ts";
export * from "./hooks/useTheme.ts";
export * from "./services/SchemaControl.ts";
export * from "./services/UiPersistence.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  export interface State {
    "alepha.react.ui": UiState;
    "alepha.react.ui.themes": UiThemeList;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Persisted UI state: color mode, theme palette, sidebar collapsed state.
 *
 * Backed by an `alepha-ui` cookie so preferences survive reloads and are
 * available during SSR (no flash of wrong theme).
 *
 * @module alepha.react.ui
 */
export const AlephaReactUi = $module({
  name: "alepha.react.ui",
  atoms: [uiThemeListAtom],
  services: [UiPersistence],
});
