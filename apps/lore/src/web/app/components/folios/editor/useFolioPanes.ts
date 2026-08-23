import { useCallback, useEffect, useState } from "react";

/**
 * The workspace's side panes: whether each one is visible, whether it is
 * currently a column or an overlay drawer, and the three commands View▸
 * (and ⌘\, ⌘⌥I, ⌘.) drives them with.
 */
export interface FolioPanesState {
  treeOpen: boolean;
  inspectorOpen: boolean;
  /**
   * `true` once the viewport is too narrow for the pane to take a column
   * of its own — the workspace then floats it over the document instead.
   */
  treeDrawer: boolean;
  inspectorDrawer: boolean;
  toggleTree: () => void;
  toggleInspector: () => void;
  toggleFocus: () => void;
  /**
   * The tree pane's width in pixels, and the setter its drag handle calls.
   * Persisted like the open/closed preference: someone working in deep
   * directory paths widens it once, not once per session.
   */
  treeWidth: number;
  setTreeWidth: (width: number) => void;
}

export const TREE_MIN_WIDTH = 180;
export const TREE_MAX_WIDTH = 480;
export const TREE_DEFAULT_WIDTH = 242;
const TREE_WIDTH_KEY = "lor.folio.workspace.treeWidth";

/**
 * The design is 1660px wide. At 1280px the three columns leave the
 * document ~460px, too narrow to write in — so each pane converts to an
 * overlay at the width where keeping it as a column would start eating the
 * text.
 */
const INSPECTOR_DRAWER_BELOW = 1280;
const TREE_DRAWER_BELOW = 1024;

const TREE_KEY = "lor.folio.workspace.treeOpen";
const INSPECTOR_KEY = "lor.folio.workspace.inspectorOpen";

/**
 * `undefined` — never toggled on this browser, so the pane follows the
 * viewport's default. An explicit `true`/`false` is the user overruling
 * that default, and it outlives the tab. Storing "no opinion" distinctly
 * from `false` is what lets a narrow viewport default the inspector closed
 * without that default hardening into a stored preference the user never
 * expressed.
 */
const readPreference = (key: string): boolean | undefined => {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
};

const writePreference = (key: string, value: boolean): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "1" : "0");
};

/**
 * Tracks a `max-width` media query. Starts wide on the server — the app
 * renders on the server first and there is no viewport there to measure;
 * assuming the design's own width keeps the first paint the desktop
 * layout, and the effect below corrects it on the client before the user
 * can interact.
 */
const useNarrowerThan = (breakpoint: number): boolean => {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = (): void => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [breakpoint]);

  return narrow;
};

/**
 * Owns the tree/inspector visibility for the whole workspace, including
 * focus mode (⌘.).
 *
 * Visibility is derived, never stored: `preference ?? !isDrawer`. A pane
 * the user has never touched follows the viewport (a column is open, a
 * drawer is closed), and one they HAVE touched keeps whatever they chose,
 * on this browser, until they choose otherwise. Focus mode sits on top of
 * both as a transient override — it hides the panes without recording that
 * it did, so leaving focus mode restores exactly the layout the user had
 * rather than a layout focus mode invented.
 *
 * Lives here rather than in `FolioWorkspace.tsx` because the panes it
 * governs mount at two different depths — the tree directly in the
 * workspace, the inspector inside the folio-keyed content below it — so
 * the state has to be above both, and being a hook makes the derivation
 * testable without standing up either pane.
 */
export const useFolioPanes = (): FolioPanesState => {
  const treeDrawer = useNarrowerThan(TREE_DRAWER_BELOW);
  const inspectorDrawer = useNarrowerThan(INSPECTOR_DRAWER_BELOW);

  const [treePreference, setTreePreference] = useState<boolean | undefined>(
    () => readPreference(TREE_KEY),
  );
  const [inspectorPreference, setInspectorPreference] = useState<
    boolean | undefined
  >(() => readPreference(INSPECTOR_KEY));
  const [focus, setFocus] = useState(false);

  const treeOpen = focus ? false : (treePreference ?? !treeDrawer);
  const inspectorOpen = focus
    ? false
    : (inspectorPreference ?? !inspectorDrawer);

  const toggleTree = useCallback(() => {
    const next = !treeOpen;
    setTreePreference(next);
    writePreference(TREE_KEY, next);
    // Asking for a pane while in focus mode is asking to leave focus mode:
    // otherwise the toggle would record a preference and visibly do
    // nothing.
    setFocus(false);
  }, [treeOpen]);

  const toggleInspector = useCallback(() => {
    const next = !inspectorOpen;
    setInspectorPreference(next);
    writePreference(INSPECTOR_KEY, next);
    setFocus(false);
  }, [inspectorOpen]);

  const toggleFocus = useCallback(() => setFocus((v) => !v), []);

  const [treeWidth, setTreeWidthState] = useState<number>(() => {
    if (typeof window === "undefined") return TREE_DEFAULT_WIDTH;
    const raw = Number(window.localStorage.getItem(TREE_WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return TREE_DEFAULT_WIDTH;
    return Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, raw));
  });

  const setTreeWidth = useCallback((width: number) => {
    // Clamped here rather than at the drag handle so a stored value from a
    // wider monitor cannot come back as a pane that eats the document.
    const clamped = Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, width));
    setTreeWidthState(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TREE_WIDTH_KEY, String(clamped));
    }
  }, []);

  return {
    treeOpen,
    inspectorOpen,
    treeDrawer,
    inspectorDrawer,
    toggleTree,
    toggleInspector,
    toggleFocus,
    treeWidth,
    setTreeWidth,
  };
};
