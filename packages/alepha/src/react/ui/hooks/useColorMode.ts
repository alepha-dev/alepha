import { useStore } from "alepha/react";
import { useSyncExternalStore } from "react";

import { uiAtom } from "../atoms/uiAtom.ts";

export type ColorMode = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

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

const matchDark = (): MediaQueryList | undefined =>
  typeof window === "undefined" ? undefined : window.matchMedia?.(DARK_QUERY);

const subscribeSystemDark = (onChange: () => void) => {
  const mq = matchDark();
  if (!mq) {
    return () => {};
  }
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

const getSystemDark = () => matchDark()?.matches ?? false;

const useResolvedColorMode = (mode: ColorMode): ResolvedColorMode => {
  // The server snapshot is `false`, which React also uses for the client's
  // hydration render — `window.matchMedia` is client-only, so reading it there
  // would make the first client render disagree with the server for
  // `mode === "system"` (server resolves "light", a dark-OS client resolves
  // "dark"), tripping a React hydration mismatch (#418) on any SSR'd page that
  // renders off `resolved` (e.g. the color-mode toggle icon). The real OS
  // preference lands on the first commit after hydration. No-flash CSS is
  // handled separately by the boot script, so this costs at most a one-frame
  // icon correction, never a color flash.
  //
  // `useSyncExternalStore` rather than state synced from an effect: same two
  // renders, but the subscription and the snapshot are the same source, so the
  // value cannot go stale between mount and the first `change` event.
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    () => false,
  );

  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemDark ? "dark" : "light";
};
