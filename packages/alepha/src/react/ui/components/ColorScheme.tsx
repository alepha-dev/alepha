import { useEffect } from "react";

import { useColorMode } from "../hooks/useColorMode.ts";
import { useTheme } from "../hooks/useTheme.ts";

/**
 * Applies `class="dark"` and an optional theme palette class
 * (`theme-<name>`) to the document root, syncing whenever the underlying
 * atom mutates.
 *
 * Mount once near the root of your tree (typically inside the layout).
 *
 * @example
 * <ColorScheme />
 */
export function ColorScheme() {
  const { resolved } = useColorMode();
  const { theme } = useTheme();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

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

  return null;
}
