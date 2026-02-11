import { useCallback, useMemo, useState } from "react";

export interface UseTableSelectionReturn<T> {
  selectedItems: T[];
  allSelected: boolean;
  someSelected: boolean;
  toggleItem: (item: T) => void;
  toggleAll: () => void;
  clear: () => void;
  isSelected: (item: T) => boolean;
}

export const useTableSelection = <T>(
  items: T[],
  getItemKey: (item: T) => string,
  enabled: boolean,
): UseTableSelectionReturn<T> => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const selectedItems = useMemo(() => {
    if (!enabled) return [];
    return items.filter((item) => selectedKeys.has(getItemKey(item)));
  }, [items, selectedKeys, getItemKey, enabled]);

  const allSelected = useMemo(() => {
    if (items.length === 0) return false;
    return items.every((item) => selectedKeys.has(getItemKey(item)));
  }, [items, selectedKeys, getItemKey]);

  const someSelected = useMemo(() => {
    if (items.length === 0) return false;
    const count = items.filter((item) =>
      selectedKeys.has(getItemKey(item)),
    ).length;
    return count > 0 && count < items.length;
  }, [items, selectedKeys, getItemKey]);

  const toggleItem = useCallback(
    (item: T) => {
      const key = getItemKey(item);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [getItemKey],
  );

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of items) next.delete(getItemKey(item));
        return next;
      });
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of items) next.add(getItemKey(item));
        return next;
      });
    }
  }, [allSelected, items, getItemKey]);

  const clear = useCallback(() => setSelectedKeys(new Set()), []);

  const isSelected = useCallback(
    (item: T) => selectedKeys.has(getItemKey(item)),
    [selectedKeys, getItemKey],
  );

  return {
    selectedItems,
    allSelected,
    someSelected,
    toggleItem,
    toggleAll,
    clear,
    isSelected,
  };
};
