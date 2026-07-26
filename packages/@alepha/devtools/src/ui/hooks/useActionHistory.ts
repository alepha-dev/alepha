import { useCallback, useEffect, useState } from "react";

export interface ActionHistoryEntry {
  at: number;
  status?: number;
  ms: number;
  error?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

const KEY = "alepha.devtools.history";
const PER_ACTION = 20;

const readAll = (): Record<string, ActionHistoryEntry[]> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/**
 * Per-action request history, kept in `localStorage`.
 *
 * Re-typing a request body to retry a call is the main reason people abandon a
 * Try It tab, so executions are recorded and can be restored into the form.
 */
export const useActionHistory = (actionKey: string) => {
  const [entries, setEntries] = useState<ActionHistoryEntry[]>([]);

  const refresh = useCallback(() => {
    setEntries(readAll()[actionKey] ?? []);
  }, [actionKey]);

  useEffect(refresh, [refresh]);

  const record = useCallback(
    (entry: ActionHistoryEntry) => {
      const all = readAll();
      all[actionKey] = [entry, ...(all[actionKey] ?? [])].slice(0, PER_ACTION);
      try {
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        // Storage full or unavailable — history is a convenience, not state
        // anything depends on.
      }
      setEntries(all[actionKey]);
    },
    [actionKey],
  );

  const clear = useCallback(() => {
    const all = readAll();
    delete all[actionKey];
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // See above.
    }
    setEntries([]);
  }, [actionKey]);

  return { entries, record, clear };
};
