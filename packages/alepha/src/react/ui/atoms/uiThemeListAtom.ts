import { $atom, type Static, t } from "alepha";

/**
 * Available themes the user can pick from. Apps populate this atom on boot
 * (e.g. `alepha.store.set(uiThemeListAtom, MY_THEMES)`); UI consumers like
 * `<ButtonTheme/>` read it to render a picker. The selected theme id is
 * persisted separately in `uiAtom.theme`.
 *
 * Defaults to a single `"default"` entry so the registry stays usable when
 * an app doesn't declare its own list.
 */
export const uiThemeListAtom = $atom({
  name: "alepha.react.ui.themes",
  schema: t.array(
    t.object({
      /** Stable id stored in `uiAtom.theme`. Mapped to a CSS class on `<html>`. */
      id: t.string(),
      /** Human-readable label shown in the picker. */
      label: t.string(),
      /**
       * Optional 4-color preview swatch in 2×2 order (TL, TR, BL, BR). Any
       * CSS-valid color string.
       */
      swatch: t.optional(t.array(t.string(), { minItems: 4, maxItems: 4 })),
      /**
       * Optional stylesheet URL (typically Google Fonts) loaded lazily when
       * the theme is selected.
       */
      fontHref: t.optional(t.string()),
    }),
  ),
  default: [{ id: "default", label: "Default" }],
});

export type UiThemeList = Static<typeof uiThemeListAtom.schema>;
export type UiTheme = UiThemeList[number];
