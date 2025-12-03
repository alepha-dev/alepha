import { $head } from "@alepha/react/head";
import { $atom, $inject, Alepha, type Static, t } from "alepha";
import { $cookie } from "alepha/server/cookies";

export const themeAtom = $atom({
  name: "alepha.ui.theme",
  schema: t.object({
    id: t.string(),
    primaryColor: t.optional(t.text()),
    primaryShade: t.optional(
      t.object({
        light: t.integer(),
        dark: t.integer(),
      }),
    ),
  }),
  default: {
    id: "default",
    primaryColor: "blue",
  },
});

export type Theme = Static<typeof themeAtom.schema>;

export class ThemeService {
  protected readonly alepha = $inject(Alepha);
  protected themeCookie = $cookie(themeAtom);

  public themes = [
    {
      id: "default",
      label: "Default",
      description: "Mantine defaults with no customization",
      primaryColor: "blue",
      primaryShade: { light: 6, dark: 5 },
    },
    {
      id: "midnight",
      label: "Midnight",
      description: "Clean, developer-focused design",
      primaryColor: "gray",
      primaryShade: { light: 8, dark: 8 },
    },
    {
      id: "slate",
      label: "Slate",
      description: "Professional, minimal zinc palette",
      primaryColor: "dark",
      primaryShade: { light: 9, dark: 0 },
    },
    {
      id: "aurora",
      label: "Aurora",
      description: "Vibrant, playful with gradients and hover effects",
      primaryColor: "violet",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "ember",
      label: "Ember",
      description: "Warm, cozy with stone tints",
      primaryColor: "orange",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "crystal",
      label: "Crystal",
      description: "Glass-morphism with backdrop blur effects",
      primaryColor: "blue",
      primaryShade: { light: 5, dark: 4 },
    },
  ];

  protected themeHead = $head(() => {
    return {
      htmlAttributes: {
        "data-theme": this.getTheme().id,
      },
    };
  });

  public setTheme(theme: Theme) {
    this.themeCookie.set(theme);
    this.alepha.store.set(themeAtom, theme);

    if (typeof document === "undefined") return;

    document.documentElement.removeAttribute("data-theme");

    if (theme.id !== "default") {
      document.documentElement.setAttribute("data-theme", theme.id);
    }
  }

  public getTheme() {
    // TODO: make a safe cookie getter, today it crash when Cookie Server is called inside vite pre-render
    try {
      return this.themeCookie.get() ?? this.alepha.store.get(themeAtom);
    } catch {
      return this.alepha.store.get(themeAtom);
    }
  }
}
