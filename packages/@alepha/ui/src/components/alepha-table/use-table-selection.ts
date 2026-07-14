import { useCallback, useMemo, useState } from "react";

export interface TableSelection<T> {
  /**
   * Selected rows across every page, keyed by `rowKey`. `size` and `has`
   * are what the table renders against.
   */
  selection: ReadonlyMap<string, T>;
  /**
   * The selected row objects across every page — always consistent with
   * `selection.size`, so a bulk action can never receive fewer rows than
   * the count shown to the user.
   */
  selectedItems: T[];
  /**
   * Whether every row of the current page is selected.
   */
  allSelected: boolean;
  /**
   * Whether some (but not all) rows of the current page are selected.
   */
  someSelected: boolean;
  toggleRow: (item: T) => void;
  toggleAll: () => void;
  clearSelection: () => void;
}

/**
 * Cross-page row selection for AlephaTable.
 *
 * Selected rows are cached as full objects (not just keys) so paging away
 * and back never desynchronizes the selection count from the items handed
 * to bulk actions. `toggleAll` operates on the current page only;
 * `clearSelection` drops everything.
 */
export const useTableSelection = <T>(
  data: T[],
  rowKey: (item: T) => string,
): TableSelection<T> => {
  const [selection, setSelection] = useState<Map<string, T>>(new Map());

  const clearSelection = useCallback(() => setSelection(new Map()), []);

  const selectedItems = useMemo(
    () => Array.from(selection.values()),
    [selection],
  );

  const allSelected =
    data.length > 0 && data.every((it) => selection.has(rowKey(it)));
  const someSelected =
    !allSelected && data.some((it) => selection.has(rowKey(it)));

  const toggleRow = useCallback(
    (item: T) => {
      setSelection((prev) => {
        const next = new Map(prev);
        const key = rowKey(item);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.set(key, item);
        }
        return next;
      });
    },
    [rowKey],
  );

  const toggleAll = useCallback(() => {
    setSelection((prev) => {
      const next = new Map(prev);
      const pageFullySelected =
        data.length > 0 && data.every((it) => prev.has(rowKey(it)));
      for (const it of data) {
        if (pageFullySelected) {
          next.delete(rowKey(it));
        } else {
          next.set(rowKey(it), it);
        }
      }
      return next;
    });
  }, [data, rowKey]);

  return {
    selection,
    selectedItems,
    allSelected,
    someSelected,
    toggleRow,
    toggleAll,
    clearSelection,
  };
};
