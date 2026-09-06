import { useSyncExternalStore } from "react";

/**
 * Never changes: the machine does not turn into a different one mid-session.
 */
const NO_CHANGES = () => () => {};

const readModifier = () =>
  /mac/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

/**
 * What a prerendered page has to guess. `⌘` because the reader most likely to
 * notice a wrong keycap is the one who reaches for it, and this site is read
 * on a laptop.
 */
const prerenderedModifier = () => "⌘";

/**
 * The modifier this machine's ⌘K / Ctrl+K actually uses, for a keycap hint.
 *
 * Read through `useSyncExternalStore` rather than an effect: every page here
 * is PRERENDERED, so the cap is decided twice - once for HTML served to every
 * reader, and once for the machine that hydrates it. The server snapshot is
 * what the build ships, the client snapshot corrects it on mount, and React
 * treats the difference as expected instead of as a hydration mismatch. An
 * effect writing state would reach the same place one render later, and lint
 * rejects it (`react/set-state-in-effect`).
 */
export const useShortcutModifier = (): string =>
  useSyncExternalStore(NO_CHANGES, readModifier, prerenderedModifier);
