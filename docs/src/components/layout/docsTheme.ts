export type Mode = "dark" | "light";

export const MODE_KEY = "alepha-docs-mode";

/**
 * The theme this visitor should get, resolved the same way twice.
 *
 * Two things decide it and they run at different moments: an inline script in
 * `<head>` (see {@link DOCS_THEME_BOOT_SCRIPT}), before a single byte of the
 * bundle has parsed, and `DarkModeToggle`'s mount effect once React is running.
 * They cannot share code - the first one is a string evaluated by the browser
 * before any module exists - so they share a file instead, and the rule is
 * written out once above both.
 *
 * They disagreed for as long as both existed: the script honoured
 * `localStorage` only and fell back to dark, while this honoured
 * `prefers-color-scheme: light` as well. A visitor on a light OS with nothing
 * stored therefore got a dark page painted, then a light one a frame later -
 * the flash that a boot script exists to prevent.
 *
 * The order is: an explicit stored choice, then the OS preference, then dark.
 * Stored wins because it is the only one the visitor made deliberately.
 */
export const getInitialMode = (): Mode => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }
  return "dark";
};

/**
 * The same decision as {@link getInitialMode}, as a string for `<head>`.
 *
 * ⚠️ Keep the two in step. This one runs first and paints; the other runs at
 * mount and overwrites. Any disagreement is a visible flash on exactly the
 * visitors the two answer differently for, and on nobody else - which is what
 * made the last one survive so long.
 *
 * It writes `data-theme` on `<html>`, which is OUTSIDE React's tree: the app
 * hydrates `#root`, a div in the body, so this attribute is not something
 * hydration can disagree about. It is a paint, not a render.
 */
export const DOCS_THEME_BOOT_SCRIPT = `
  var stored = localStorage.getItem('${MODE_KEY}');
  var theme = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
`.trim();
