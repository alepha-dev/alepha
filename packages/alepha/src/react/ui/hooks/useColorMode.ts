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
  // Must start `false` on BOTH the server and the client's first (hydration)
  // render — `window.matchMedia` is client-only, so a lazy initializer reading
  // it would make the first client render disagree with the server for
  // `mode === "system"` (server resolves "light", a dark-OS client resolves
  // "dark"), tripping a React hydration mismatch (#418) on any SSR'd page that
  // renders off `resolved` (e.g. the color-mode toggle icon). The real OS
  // preference is synced in the effect below, immediately after mount. No-flash
  // CSS is handled separately by the boot script, so this costs at most a
  // one-frame icon correction, never a color flash.
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    setSystemDark(mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setSystemDark(ev.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemDark ? "dark" : "light";
};
