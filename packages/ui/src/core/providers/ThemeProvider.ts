import { $head } from "@alepha/react/head";
import { $inject, Alepha, AlephaError } from "alepha";
import { $cookie } from "alepha/server/cookies";
import { alephaThemeAtom } from "../atoms/alephaThemeAtom.ts";
import { alephaThemeListAtom } from "../atoms/alephaThemeListAtom.ts";
import { defaultTheme } from "../atoms/themes/default.ts";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";

export class ThemeProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly cookie = $cookie({
    name: "theme",
    schema: alephaThemeAtom.schema,
    ttl: [1, "year"],
  });

  protected readonly head = $head(() => {
    const theme = this.getTheme();
    if (!theme || !theme.name) {
      return {};
    }
    return {
      htmlAttributes: {
        "data-theme": theme.name,
      },
    };
  });

  public setTheme(index: number) {
    const newTheme = this.alepha.store.get(alephaThemeListAtom)[
      index
    ] as AlephaTheme;

    if (!newTheme) {
      throw new AlephaError(`Theme with index ${index} not found`);
    }

    this.cookie.set({ index });
    this.alepha.store.set(alephaThemeAtom, { index });

    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.removeAttribute("data-theme");

    if (newTheme.name) {
      document.documentElement.setAttribute("data-theme", newTheme.name);
    }
  }

  public getTheme() {
    const index = this.getThemeIndex();
    const list = this.alepha.store.get(
      alephaThemeListAtom,
    ) as Array<AlephaTheme>;
    return list[index] || list[0] || defaultTheme;
  }

  protected getThemeIndex() {
    // TODO: make a safe cookie getter, today it crash when Cookie Server is called inside vite pre-render
    try {
      return (
        this.cookie.get()?.index ??
        this.alepha.store.get(alephaThemeAtom)?.index ??
        0
      );
    } catch {
      return this.alepha.store.get(alephaThemeAtom)?.index ?? 0;
    }
  }
}
