import { useStore } from "alepha/react";
import { useEffect } from "react";

import { uiThemeListAtom } from "../atoms/uiThemeListAtom.ts";
import { useColorMode } from "../hooks/useColorMode.ts";
import { useTheme } from "../hooks/useTheme.ts";

const FONT_LINK_ID = "alepha-theme-fonts";

/**
 * Applies `class="dark"` and an optional theme palette class
 * (`theme-<name>`) to the document root, syncing whenever the underlying
 * atom mutates. Also injects the active theme's `fontHref` stylesheet as a
 * single `<link id="alepha-theme-fonts">` in `<head>`, swapping it when the
 * theme changes and removing it when the theme declares no font.
 *
 * Mount once near the root of your tree (typically inside the layout).
 *
 * The font link lives here rather than in `<ButtonTheme/>` because a picker
 * only renders on pages that show one: mounted there, a theme's colors
 * applied everywhere while its font loaded nowhere but the pages with a
 * toolbar, and `--font-display` silently fell back down its stack on the
 * rest. This component is already the one an app mounts unconditionally.
 *
 * @example
 * <ColorScheme />
 */
export const ColorScheme = () => {
  const { mode, resolved } = useColorMode();
  const { theme } = useTheme();
  const [list] = useStore(uiThemeListAtom);

  // Resolved to a plain string so the effect below depends on the value, not
  // on the identity of an array that is rebuilt on every render.
  const themes = list ?? [];
  const fontHref = (themes.find((t) => t.id === theme) ?? themes[0])?.fontHref;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  /**
   * The UNRESOLVED preference, for the things `.dark` cannot express.
   *
   * `.dark` says what the page looks like; it cannot say why. "System, which
   * resolved to dark" and "dark, chosen deliberately" produce the same class,
   * so a three-state control cannot draw itself from it.
   *
   * On `<html>`, outside React's tree, which is the whole point: a component
   * that renders the same markup and lets CSS choose between the copies cannot
   * disagree with prerendered HTML at hydration. See `ButtonDark`.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-color-mode", mode);
  }, [mode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous: string[] = [];
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) previous.push(cls);
    });
    for (const cls of previous) root.classList.remove(cls);
    if (theme && theme !== "default") root.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const existing = document.getElementById(FONT_LINK_ID);
    if (!fontHref) {
      existing?.remove();
      return;
    }
    if (existing?.getAttribute("href") === fontHref) {
      return;
    }
    existing?.remove();
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = fontHref;
    document.head.appendChild(link);
  }, [fontHref]);

  return null;
};
