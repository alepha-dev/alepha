import type { Alepha, ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  persistedSummaryOpen,
  writePersisted,
} from "./dataTablePersistence.ts";
import type {
  DataTableFilterFields,
  DataTableStatCard,
  DataTableSummary,
} from "./dataTableTypes.ts";

export interface UseDataTableSummaryOptions {
  summary: DataTableSummary<DataTableFilterFields> | undefined;
  /**
   * The key the panel's open state is stored under, or `undefined` when the
   * table stores nothing.
   */
  persistenceKey: string | undefined;
  /**
   * The table's reload counter. Every reload of the SET bumps it (a filter
   * change, Refresh, `refreshSignal`, a poll, an action's `refresh()`), and a
   * page or a sort does not, which is exactly when the figures change.
   */
  refreshKey: number;
  form: FormModel<ZObject> | undefined;
  alepha: Alepha;
}

/**
 * The state of `DataTable`'s summary panel: whether it is open, and the cards
 * it shows, fetched with the table's filters when the caller gave a `fetch`.
 */
export const useDataTableSummary = (options: UseDataTableSummaryOptions) => {
  const { summary, persistenceKey, refreshKey, form, alepha } = options;

  const [open, setOpenState] = useState(() =>
    persistedSummaryOpen(persistenceKey),
  );
  // `undefined` until the first fetch lands, which is what tells the panel
  // to draw its placeholder tiles rather than nothing.
  const [fetched, setFetched] = useState<DataTableStatCard[] | undefined>();
  const [loading, setLoading] = useState(false);

  // Held in a ref and out of the effect's dependencies, for the reason
  // `useDataTableData` gives for `fetch`: callers write it inline, so it is a
  // new function every render, and a dependency on it refetches forever.
  const fetchRef = useRef(summary?.fetch);
  fetchRef.current = summary?.fetch;
  const onErrorRef = useRef(summary?.onError);
  onErrorRef.current = summary?.onError;
  const fetches = Boolean(summary?.fetch);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (persistenceKey) writePersisted(persistenceKey, "summaryOpen", next);
    },
    [persistenceKey],
  );

  /**
   * Read the open state of another scope, and forget the cards of this one.
   * Called by `DataTable` during the render where `persistenceKey` changes,
   * like the rest of the scope's state: the figures of the project just left
   * must not sit under the name of the one just opened while it loads.
   */
  const resetScope = useCallback((key: string | undefined) => {
    setOpenState(persistedSummaryOpen(key));
    setFetched(undefined);
  }, []);

  useEffect(() => {
    const fetcher = fetchRef.current;
    // Collapsed, nothing is on screen to be right about: opening fetches.
    if (!fetcher || !open) return;
    const controller = new AbortController();
    setLoading(true);
    fetcher({
      // A copy: `currentValues` is mutated in place as the reader types.
      filters: form ? { ...form.currentValues } : undefined,
      signal: controller.signal,
    })
      .then((cards) => {
        if (!controller.signal.aborted) setFetched(cards);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // The last cards stay up, like the table's rows. With none yet, the
        // placeholders go: tiles pulsing over a read that failed would say
        // it is still coming. No card is no panel, until a reload succeeds.
        setFetched((cards) => cards ?? []);
        // The table's own channel for a failed read, so a mounted
        // `ActionErrorToaster` reports it, unless the caller handles it: the
        // `onError` convention of `useQuery`, where the event still fires for
        // error reporting and the toaster skips it.
        const onError = onErrorRef.current;
        void alepha.events.emit("react:action:error", {
          type: "custom",
          id: "data-table:summary",
          error: error as Error,
          handled: onError !== undefined,
        });
        onError?.(error as Error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    // A newer load, a collapse or an unmount supersedes this one. Aborted
    // rather than ignored, so a fetcher that forwards the signal cancels the
    // request itself. `loading` is cleared here because the aborted load's
    // own `finally` leaves it alone, and a collapse starts no load to take
    // it over.
    return () => {
      controller.abort();
      setLoading(false);
    };
  }, [fetches, open, refreshKey, form, alepha]);

  const cards = summary?.fetch ? fetched : (summary?.cards ?? []);

  return { open, setOpen, resetScope, cards, loading };
};
