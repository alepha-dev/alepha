import { $head } from "@alepha/react/head";
import type { MantineThemeOverride } from "@mantine/core";
import { $atom, $inject, Alepha, type Static, t } from "alepha";
import { $cookie } from "alepha/server/cookies";
import {
  auroraTheme,
  crystalTheme,
  defaultTheme,
  emberTheme,
  midnightTheme,
  remoraidTheme,
  slateTheme,
} from "../themes/index.ts";

export const themeAtom = $atom({
  name: "alepha.ui.theme",
  schema: t.object({
    id: t.string(),
  }),
  default: {
    id: "default",
  },
});

export type Theme = Static<typeof themeAtom.schema>;

declare module "alepha" {
  interface State {
    [themeAtom.key]?: Theme;
  }
}

export type AlephaTheme = MantineThemeOverride & {
  id: string;
  label: string;
  description: string;
};

export class ThemeProvider {
  protected readonly alepha = $inject(Alepha);
  protected themeCookie = $cookie(themeAtom);

  public themes: AlephaTheme[] = [
    defaultTheme,
    remoraidTheme,
    midnightTheme,
    slateTheme,
    auroraTheme,
    emberTheme,
    crystalTheme,
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
      return (
        this.themeCookie.get() ??
        this.alepha.store.get(themeAtom) ??
        themeAtom.options.default
      );
    } catch {
      // TODO: atom should take default value if undefined ???
      return this.alepha.store.get(themeAtom) ?? themeAtom.options.default;
    }
  }
}
