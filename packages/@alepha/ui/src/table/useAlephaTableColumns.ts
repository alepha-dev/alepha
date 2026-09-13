import type { I18nProvider } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { AlephaTableBaseProps } from "./alephaTableBaseProps.ts";
import {
  persistedColumns,
  persistedOrder,
  reconcileOrder,
  writePersisted,
} from "./alephaTablePersistence.ts";
import type { AlephaTableSource } from "./alephaTableTypes.ts";

export interface UseAlephaTableColumnsOptions<T> {
  props: AlephaTableBaseProps<T> & AlephaTableSource<T>;
  /**
   * The key the column visibility and order are persisted under, or
   * `undefined` when the table does not store them.
   */
  columnsKey: string | undefined;
  tr: I18nProvider<any, any>["tr"];
}

/**
 * Which columns `AlephaTable` shows, and in what order: the visible set, the
 * reader's order reconciled against the declared columns, and the moves and
 * toggles that change them.
 *
 * The two setters are returned too, for the scope change in `AlephaTable`,
 * which re-reads both when `persistenceKey` moves.
 */
export const useAlephaTableColumns = <T>(
  options: UseAlephaTableColumnsOptions<T>,
) => {
  const { props, columnsKey, tr } = options;

  // -- Column visibility -----------------------------------------------------

  const allColumnKeys = useMemo(
    () => Object.keys(props.columns),
    [props.columns],
  );

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    persistedColumns(columnsKey, props.columns),
  );

  /**
   * The reader's column order. Held as the raw preference and reconciled on
   * every read below, so a caller adding a column at runtime is handled by
   * the same code path as a stale stored array.
   */
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    persistedOrder(columnsKey, props.columns),
  );

  const orderedKeys = useMemo(
    () => reconcileOrder(columnOrder, allColumnKeys),
    [columnOrder, allColumnKeys],
  );

  /**
   * Move one column one slot, within the VISIBLE sequence.
   *
   * Over the visible columns and not the full order, because nudging a column
   * past a hidden one would look like nothing happened - the reader would
   * press "move left" and see the table unchanged. A swap rather than a
   * splice, so the hidden columns between the two keep their places.
   */
  const moveColumn = (key: string, delta: -1 | 1) => {
    const visible = orderedKeys.filter((k) => visibleColumns.has(k));
    const at = visible.indexOf(key);
    const target = visible[at + delta];
    if (at < 0 || target === undefined) return;
    const next = [...orderedKeys];
    const from = next.indexOf(key);
    const to = next.indexOf(target);
    next[from] = target;
    next[to] = key;
    commitOrder(next);
    // Announced, or the change is silent for a screen reader: nothing else
    // about a reordered table is spoken.
    setOrderAnnouncement(
      tr("alephaTable.columnMoved", {
        default: `${String(props.columns[key]?.label ?? key)} moved to position ${at + delta + 1} of ${visible.length}`,
        args: [
          String(props.columns[key]?.label ?? key),
          String(at + delta + 1),
          String(visible.length),
        ],
      }),
    );
  };

  /**
   * Drop `key` onto `target`'s slot, which is what a drag in the column
   * picker means. Unlike {@link moveColumn} this walks the FULL order: the
   * picker lists hidden columns too, so a drag there can legitimately cross
   * one.
   */
  const reorderColumn = (key: string, target: string) => {
    if (key === target) return;
    const next = orderedKeys.filter((k) => k !== key);
    next.splice(next.indexOf(target), 0, key);
    commitOrder(next);
  };

  const commitOrder = (next: string[]) => {
    setColumnOrder(next);
    if (columnsKey) {
      writePersisted(columnsKey, "columnOrder", next);
    }
  };

  /**
   * What the live region says after a move. Cleared and re-set on each one,
   * so two moves in a row are both announced.
   */
  const [orderAnnouncement, setOrderAnnouncement] = useState("");

  /**
   * Written on a TOGGLE, never on mount - the same rule the filter-persist
   * effect follows above, and for the same reason.
   *
   * As a mount effect this stamped the current set into storage on first
   * paint, which froze the column layout of every reader who had merely
   * OPENED the table. A `defaultHidden` added to a column afterwards then did
   * nothing for them, permanently and with no way to notice: the stored set
   * had no `defaultHidden` in it to be out of date. It also made
   * `defaultHidden` unusable as a controlled prop, since a remount read back
   * what the previous mount had written rather than the new default.
   */
  const toggleColumn = (id: string) => {
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleColumns(next);
    if (columnsKey) {
      writePersisted(columnsKey, "columns", [...next]);
    }
  };

  return {
    allColumnKeys,
    visibleColumns,
    setVisibleColumns,
    orderedKeys,
    setColumnOrder,
    moveColumn,
    reorderColumn,
    toggleColumn,
    orderAnnouncement,
  };
};
