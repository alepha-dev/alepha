import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

const LORE_THEMES: UiTheme[] = [
  {
    id: "default",
    label: "Crossroads",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
    fontHref: "/fonts/default.css",
  },
  {
    id: "sylvan",
    label: "Sylvan",
    swatch: ["#2f6b3b", "#6fa44c", "#e9efde", "#1d2a1a"],
    fontHref: "/fonts/sylvan.css",
  },
  {
    id: "arcane",
    label: "Arcane",
    swatch: ["#5a3a9c", "#8a6cc9", "#ece6f6", "#20183c"],
    fontHref: "/fonts/arcane.css",
  },
  {
    id: "frost",
    label: "Frostfell",
    swatch: ["#3a78c9", "#9fb6d8", "#ecf0f5", "#1c2436"],
    fontHref: "/fonts/frost.css",
  },
  {
    id: "twilight",
    label: "Twilight",
    swatch: ["#0969da", "#4493f8", "#f6f8fa", "#0d1117"],
    fontHref: "/fonts/default.css",
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
