import { $hook, $inject, Alepha } from "alepha";
import { type UiTheme, uiThemeListAtom } from "alepha/react/ui";

export class ThemesProvider {
  alepha = $inject(Alepha);

  /**
   * The themes Lore offers, on the class so a test or a subclass can replace
   * the list.
   *
   * A swatch is the theme's own tokens, read from `apps/lore/src/main.css`
   * and never picked by eye: for Forest, Lavandula and Winter, the light
   * primary, the dark primary, the light page and the dark card. A token
   * that moves takes its swatch with it.
   */
  protected readonly themes: UiTheme[] = [
    {
      id: "default",
      label: "Neutral",
      swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
      fontHref: "/fonts/default.css",
    },
    {
      id: "forest",
      label: "Forest",
      swatch: ["#146720", "#53a640", "#ebf3e7", "#0c2310"],
      fontHref: "/fonts/forest.css",
    },
    {
      id: "lavandula",
      label: "Lavandula",
      swatch: ["#683ecf", "#9b76ff", "#f1eefd", "#181330"],
      fontHref: "/fonts/lavandula.css",
    },
    {
      id: "winter",
      label: "Winter",
      swatch: ["#006aa8", "#00aee9", "#eef7fc", "#0b1f2e"],
      fontHref: "/fonts/winter.css",
    },
    {
      id: "tangor",
      label: "Tangor",
      swatch: ["#b85434", "#f0eee6", "#faf9f5", "#262624"],
      fontHref: "/fonts/tangor.css",
    },
    {
      id: "mona",
      label: "Mona",
      swatch: ["#0969da", "#1f883d", "#f6f8fa", "#0d1117"],
      fontHref: "/fonts/mona.css",
    },
  ];

  register = $hook({
    on: "start",
    handler: async () => {
      this.alepha.store.set(uiThemeListAtom, this.themes);
    },
  });
}
