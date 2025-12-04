import { $head } from "@alepha/react/head";
import type {
  HeadingStyle,
  MantineBreakpointsValues,
  MantineColorShade,
  MantineFontSizesValues,
  MantineGradient,
  MantineLineHeightValues,
  MantinePrimaryShade,
  MantineRadius,
  MantineRadiusValues,
  MantineShadowsValues,
  MantineSpacingValues,
  MantineThemeColors,
  MantineThemeComponents,
  MantineThemeOther,
  MantineThemeOverride,
  VariantColorsResolver,
} from "@mantine/core";
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

interface MantineTheme {
  /** Controls focus ring styles. Supports the following options:
   *  - `auto` – focus ring is displayed only when the user navigates with keyboard (default value)
   *  - `always` – focus ring is displayed when the user navigates with keyboard and mouse
   *  - `never` – focus ring is always hidden (not recommended)
   */
  focusRing: "auto" | "always" | "never";

  /** rem units scale, change if you customize font-size of `<html />` element
   *  default value is `1` (for `100%`/`16px` font-size on `<html />`)
   */
  scale: number;

  /** Determines whether `font-smoothing` property should be set on the body, `true` by default */
  fontSmoothing: boolean;

  /** White color */
  white: string;

  /** Black color */
  black: string;

  /** Object of colors, key is color name, value is an array of at least 10 strings (colors) */
  colors: MantineThemeColors;

  /** Index of theme.colors[color].
   *  Primary shade is used in all components to determine which color from theme.colors[color] should be used.
   *  Can be either a number (0–9) or an object to specify different color shades for light and dark color schemes.
   *  Default value `{ light: 6, dark: 8 }`
   *
   *  For example,
   *  { primaryShade: 6 } // shade 6 is used both for dark and light color schemes
   *  { primaryShade: { light: 6, dark: 7 } } // different shades for dark and light color schemes
   * */
  primaryShade: MantineColorShade | MantinePrimaryShade;

  /** Key of `theme.colors`, hex/rgb/hsl values are not supported.
   *  Determines which color will be used in all components by default.
   *  Default value – `blue`.
   * */
  primaryColor: string;

  /** Function to resolve colors based on variant.
   *  Can be used to deeply customize how colors are applied to `Button`, `ActionIcon`, `ThemeIcon`
   *  and other components that use colors from theme.
   * */
  variantColorResolver: VariantColorsResolver;

  /** Determines whether text color must be changed based on the given `color` prop in filled variant
   *  For example, if you pass `color="blue.1"` to Button component, text color will be changed to `var(--mantine-color-black)`
   *  Default value – `false`
   * */
  autoContrast: boolean;

  /** Determines which luminance value is used to determine if text color should be light or dark.
   *  Used only if `theme.autoContrast` is set to `true`.
   *  Default value is `0.3`
   * */
  luminanceThreshold: number;

  /** font-family used in all components, system fonts by default */
  fontFamily: string;

  /** Monospace font-family, used in code and other similar components, system fonts by default  */
  fontFamilyMonospace: string;

  /** Controls various styles of h1-h6 elements, used in Typography and Title components */
  headings: {
    fontFamily: string;
    fontWeight: string;
    textWrap: "wrap" | "nowrap" | "balance" | "pretty" | "stable";
    sizes: {
      h1: HeadingStyle;
      h2: HeadingStyle;
      h3: HeadingStyle;
      h4: HeadingStyle;
      h5: HeadingStyle;
      h6: HeadingStyle;
    };
  };

  /** Object of values that are used to set `border-radius` in all components that support it */
  radius: MantineRadiusValues;

  /** Key of `theme.radius` or any valid CSS value. Default `border-radius` used by most components */
  defaultRadius: MantineRadius;

  /** Object of values that are used to set various CSS properties that control spacing between elements */
  spacing: MantineSpacingValues;

  /** Object of values that are used to control `font-size` property in all components */
  fontSizes: MantineFontSizesValues;

  /** Object of values that are used to control `line-height` property in `Text` component */
  lineHeights: MantineLineHeightValues;

  /** Object of values that are used to control breakpoints in all components,
   *  values are expected to be defined in em
   * */
  breakpoints: MantineBreakpointsValues;

  /** Object of values that are used to add `box-shadow` styles to components that support `shadow` prop */
  shadows: MantineShadowsValues;

  /** Determines whether user OS settings to reduce motion should be respected, `false` by default */
  respectReducedMotion: boolean;

  /** Determines which cursor type will be used for interactive elements
   * - `default` – cursor that is used by native HTML elements, for example, `input[type="checkbox"]` has `cursor: default` styles
   * - `pointer` – sets `cursor: pointer` on interactive elements that do not have these styles by default
   */
  cursorType: "default" | "pointer";

  /** Default gradient configuration for components that support `variant="gradient"` */
  defaultGradient: MantineGradient;

  /** Class added to the elements that have active styles, for example, `Button` and `ActionIcon` */
  activeClassName: string;

  /** Class added to the elements that have focus styles, for example, `Button` or `ActionIcon`.
   *  Overrides `theme.focusRing` property.
   */
  focusClassName: string;

  /** Allows adding `classNames`, `styles` and `defaultProps` to any component */
  components: MantineThemeComponents;

  /** Any other properties that you want to access with the theme objects */
  other: MantineThemeOther;
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
      return this.themeCookie.get() ?? this.alepha.store.get(themeAtom);
    } catch {
      return this.alepha.store.get(themeAtom);
    }
  }
}
