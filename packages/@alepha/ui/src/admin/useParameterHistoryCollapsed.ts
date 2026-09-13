import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "alepha.admin.parameters.historyCollapsed";

/**
 * Whether the Parameters History panel is collapsed to its rail, remembered
 * across reloads.
 *
 * The stored value is read after the first commit, not in a lazy
 * initialiser, for the reason `usePanelWidth` gives: the admin kit renders on
 * the server too, and a value read during the first render would differ from
 * the one the server rendered.
 */
export const useParameterHistoryCollapsed = (): [boolean, () => void] => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // oxlint-disable-next-line react/set-state-in-effect
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode, or storage denied. Open is a fine answer.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Losing the preference is not worth an error.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
};
