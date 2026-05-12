import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

const LORE_THEMES: UiTheme[] = [
  {
    id: "default",
    label: "Crossroads",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  },
  {
    id: "tavern",
    label: "Tavern",
    swatch: ["#7d3f1c", "#d6a26a", "#f4e8d0", "#2a1d12"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=EB+Garamond:wght@400;600&display=swap",
  },
  {
    id: "sylvan",
    label: "Sylvan",
    swatch: ["#2f6b3b", "#6fa44c", "#e9efde", "#1d2a1a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&display=swap",
  },
  {
    id: "arcane",
    label: "Arcane",
    swatch: ["#5a3a9c", "#8a6cc9", "#ece6f6", "#20183c"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "forge",
    label: "Forge",
    swatch: ["#b03828", "#d97a30", "#f0e2cc", "#2a160d"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "frost",
    label: "Frostfell",
    swatch: ["#3a78c9", "#9fb6d8", "#ecf0f5", "#1c2436"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Marcellus&family=Spectral:wght@400;500&display=swap",
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
