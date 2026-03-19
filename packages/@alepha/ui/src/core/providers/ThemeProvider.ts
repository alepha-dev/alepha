import { $inject, Alepha, AlephaError } from "alepha";
import { $head, BrowserHeadProvider } from "alepha/react/head";
import { $cookie } from "alepha/server/cookies";
import { alephaThemeAtom } from "../atoms/alephaThemeAtom.ts";
import { alephaThemeListAtom } from "../atoms/alephaThemeListAtom.ts";
import {
  type AlephaThemeOverrides,
  alephaThemeOverridesAtom,
} from "../atoms/alephaThemeOverridesAtom.ts";
import { defaultTheme } from "../atoms/themes/default.ts";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";

export class ThemeProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly cookie = $cookie({
    name: "theme",
    schema: alephaThemeAtom.schema,
    ttl: [1, "year"],
  });

  protected readonly overridesCookie = $cookie({
    name: "themeOverrides",
    schema: alephaThemeOverridesAtom.schema,
    ttl: [1, "year"],
  });

  protected readonly head = $head(() => {
    const theme = this.getTheme();
    if (!theme || !theme.name) {
      return {};
    }
    return {
      htmlAttributes: {
        "data-theme": this.slugify(theme.name),
      },
      ...theme.head,
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

    if (!this.alepha.isBrowser()) {
      return;
    }

    this.alepha.inject(BrowserHeadProvider).refreshGlobalHead();
  }

  protected slugify(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "-");
  }

  protected static readonly FONT_SIZE_MULTIPLIERS: Record<string, number> = {
    xs: 0.85,
    sm: 0.925,
    md: 1,
    lg: 1.1,
    xl: 1.25,
  };

  protected static readonly SCALE_VALUES: Record<string, number> = {
    xs: 0.85,
    sm: 0.925,
    md: 1,
    lg: 1.1,
    xl: 1.25,
  };

  protected static readonly DEFAULT_FONT_SIZES: Record<string, string> = {
    xs: "0.75rem",
    sm: "0.875rem",
    md: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
  };

  public getTheme() {
    const index = this.getThemeIndex();
    const list = this.alepha.store.get(
      alephaThemeListAtom,
    ) as Array<AlephaTheme>;
    const base = list[index] || list[0] || defaultTheme;
    const overrides = this.getThemeOverrides();

    if (
      !overrides.primaryColor &&
      !overrides.radius &&
      !overrides.fontFamily &&
      !overrides.fontSize &&
      !overrides.scale
    ) {
      return base;
    }

    const merged = {
      ...base,
      ...(overrides.primaryColor && { primaryColor: overrides.primaryColor }),
      ...(overrides.radius && { defaultRadius: overrides.radius }),
      ...(overrides.fontFamily && { fontFamily: overrides.fontFamily }),
      ...(overrides.scale &&
        overrides.scale !== "md" && {
          scale: ThemeProvider.SCALE_VALUES[overrides.scale] ?? 1,
        }),
    };

    if (overrides.fontSize && overrides.fontSize !== "md") {
      const multiplier =
        ThemeProvider.FONT_SIZE_MULTIPLIERS[overrides.fontSize] ?? 1;
      const baseSizes =
        (base.fontSizes as Record<string, string> | undefined) ??
        ThemeProvider.DEFAULT_FONT_SIZES;
      merged.fontSizes = Object.fromEntries(
        Object.entries(baseSizes).map(([key, val]) => [
          key,
          `${(Number.parseFloat(String(val)) * multiplier).toFixed(4)}rem`,
        ]),
      ) as typeof merged.fontSizes;
    }

    return merged;
  }

  public setThemeOverrides(overrides: AlephaThemeOverrides) {
    this.overridesCookie.set(overrides);
    this.alepha.store.set(alephaThemeOverridesAtom, overrides);

    if (!this.alepha.isBrowser()) {
      return;
    }

    this.alepha.inject(BrowserHeadProvider).refreshGlobalHead();
  }

  public getThemeOverrides(): AlephaThemeOverrides {
    try {
      return (
        this.overridesCookie.get() ??
        this.alepha.store.get(alephaThemeOverridesAtom) ??
        {}
      );
    } catch {
      return this.alepha.store.get(alephaThemeOverridesAtom) ?? {};
    }
  }

  public resetThemeOverrides() {
    this.setThemeOverrides({});
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
