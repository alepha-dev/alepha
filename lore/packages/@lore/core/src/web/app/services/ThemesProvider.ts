import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

const LORE_THEMES: UiTheme[] = [
  {
    id: "default",
    label: "Neutral",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
    fontHref: "/fonts/default.css",
  },
  {
    id: "forest",
    label: "Forest",
    swatch: ["#2f6b3b", "#6fa44c", "#e9efde", "#1d2a1a"],
    fontHref: "/fonts/forest.css",
  },
  {
    id: "lavandula",
    label: "Lavandula",
    swatch: ["#5a3a9c", "#8a6cc9", "#ece6f6", "#20183c"],
    fontHref: "/fonts/lavandula.css",
  },
  {
    id: "winter",
    label: "Winter",
    swatch: ["#3a78c9", "#9fb6d8", "#ecf0f5", "#1c2436"],
    fontHref: "/fonts/winter.css",
  },
  {
    id: "tangor",
    label: "Tangor",
    swatch: ["#b85434", "#f0eee6", "#faf9f5", "#262624"],
    fontHref: "/fonts/tangor.css",
  },
];

export class ThemesProvider {
  alepha = $inject(Alepha);

  register = $hook({
    on: "start",
    handler: async () => {
      this.alepha.store.set(uiThemeListAtom, LORE_THEMES);
    },
  });
}
