import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

/**
 * The themes `ButtonTheme` offers.
 *
 * ⚠️ Registering these is what makes the picker EXIST. `ButtonTheme` renders
 * nothing while the list holds fewer than two entries, which is correct
 * behaviour and reads as a broken build - the showcase previously had to
 * apologise for it in prose. Six entries is the fix.
 *
 * `default` carries no palette of its own on purpose: `ColorScheme` skips the
 * `theme-` class for that id, so it falls through to `@alepha/ui/styles.css`.
 * The other five have `.theme-<id>` blocks in `main.css`, each with a dark
 * counterpart.
 *
 * No `fontHref` anywhere. Lore's themes load a font per theme; here that would
 * mean shipping five typefaces to make a colour picker work, and a webfont
 * swap on every theme change is a worse first impression than a coherent
 * palette.
 */
const UI_THEMES: UiTheme[] = [
  {
    id: "default",
    label: "Default",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
  },
  {
    id: "slate",
    label: "Slate",
    swatch: ["#3f5b8b", "#e8ecf4", "#ffffff", "#5b6b85"],
  },
  {
    id: "amber",
    label: "Amber",
    swatch: ["#b06a20", "#f6ecd9", "#fffdf7", "#8a6a3c"],
  },
  {
    id: "violet",
    label: "Violet",
    swatch: ["#6b3fd4", "#ece4fa", "#fffdff", "#6e5b90"],
  },
  {
    id: "teal",
    label: "Teal",
    swatch: ["#1e7f86", "#dceef0", "#f9fdfd", "#4d7a80"],
  },
  {
    id: "rose",
    label: "Rose",
    swatch: ["#c03a53", "#f9e4e8", "#fffdfd", "#8d5964"],
  },
];

export class UiThemes {
  protected readonly alepha = $inject(Alepha);

  public readonly register = $hook({
    on: "start",
    handler: () => {
      this.alepha.store.set(uiThemeListAtom, UI_THEMES);
    },
  });
}
