import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

const ROADMAP_THEMES: UiTheme[] = [
  {
    id: "default",
    label: "Default",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  },
  {
    id: "github",
    label: "GitHub",
    swatch: ["#1f883d", "#0969da", "#f6f8fa", "#1f2328"],
  },
  {
    id: "parchment",
    label: "Parchment & Ink",
    swatch: ["#7a4a1f", "#d4a946", "#f5ecd6", "#2a1f10"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=EB+Garamond:wght@400;600&display=swap",
  },
  {
    id: "cozy",
    label: "Cozy",
    swatch: ["#5a8a3a", "#e0a060", "#f5e8c8", "#3a4a2a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&family=VT323&display=swap",
  },
  {
    id: "diablo",
    label: "Diablo",
    swatch: ["#a83228", "#d4a13a", "#1a0f08", "#e0c890"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "battlenet",
    label: "Battle.net",
    swatch: ["#148eff", "#f4a017", "#1a2840", "#e0e8f0"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap",
  },
  {
    id: "ghibli",
    label: "Ghibli",
    swatch: ["#4a9bb8", "#e8a0a0", "#f5ecd0", "#5a7a4a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Nunito:wght@400;700&display=swap",
  },
  {
    id: "claude",
    label: "Claude",
    swatch: ["#c46a3a", "#2a1f15", "#f5ecd8", "#8a6850"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;600&display=swap",
  },
  {
    id: "brutal",
    label: "Neo Brutalism",
    swatch: ["#fadc00", "#ff3a8c", "#ffffff", "#0a0a0a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap",
  },
];

export class ThemesProvider {
  alepha = $inject(Alepha);

  register = $hook({
    on: "start",
    handler: async () => {
      this.alepha.store.set(uiThemeListAtom, ROADMAP_THEMES);
    },
  });
}
