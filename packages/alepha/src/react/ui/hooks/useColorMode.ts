import { useStore } from "alepha/react";
import { useEffect, useState } from "react";
import { uiAtom } from "../atoms/uiAtom.ts";

export type ColorMode = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

/**
 * Read and update the user's color-mode preference. `"system"` resolves to
 * the OS preference and updates live as the OS toggles between light/dark.
 *
 * @example
 * const { mode, setMode, resolved } = useColorMode();
 * setMode("dark");
 * document.documentElement.classList.toggle("dark", resolved === "dark");
 */
export const useColorMode = () => {
  const [state, set] = useStore(uiAtom);
  const mode = (state?.mode ?? "system") as ColorMode;
  const resolved = useResolvedColorMode(mode);

  return {
    mode,
    resolved,
    setMode: (next: ColorMode) => {
      set({ ...(state ?? uiAtom.options.default!), mode: next });
    },
  };
};

const useResolvedColorMode = (mode: ColorMode): ResolvedColorMode => {
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (ev: MediaQueryListEvent) => setSystemDark(ev.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemDark ? "dark" : "light";
};
