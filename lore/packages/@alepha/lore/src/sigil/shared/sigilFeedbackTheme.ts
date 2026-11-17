/**
 * The colours of the floating feedback button.
 *
 * Named presets rather than a free colour. The value ends up in a stylesheet on
 * a third-party page, and a preset is the one form of it that needs no
 * sanitising: {@link sigilFeedbackThemeOf} maps anything unrecognised back to
 * the default, so nothing an operator (or anyone else) typed is ever written
 * into CSS. A preset also carries what a single colour cannot: its hover shade,
 * its focus ring and a label colour with enough contrast.
 *
 * - `indigo`: the colour the button has always had.
 * - `red`: for an app whose own accent is red.
 * - `ink`: near black, for a button that should not compete with the page.
 * - `light`: white with a hairline border, the quietest of the four.
 */
export type SigilFeedbackTheme = "indigo" | "red" | "ink" | "light";

export const SIGIL_FEEDBACK_THEMES: SigilFeedbackTheme[] = [
  "indigo",
  "red",
  "ink",
  "light",
];

export const SIGIL_FEEDBACK_THEME_DEFAULT: SigilFeedbackTheme = "indigo";

/**
 * Narrow an arbitrary string to a theme, falling back to the default.
 *
 * `undefined` is the normal case: an app that sets no
 * `SIGIL_CONFIG.feedbackButtonTheme` keeps indigo.
 */
export const sigilFeedbackThemeOf = (
  value: string | undefined,
): SigilFeedbackTheme =>
  SIGIL_FEEDBACK_THEMES.includes(value as SigilFeedbackTheme)
    ? (value as SigilFeedbackTheme)
    : SIGIL_FEEDBACK_THEME_DEFAULT;
