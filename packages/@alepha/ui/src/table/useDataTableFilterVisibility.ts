import { useCallback, useMemo, useState } from "react";

import {
  declaredShownFilters,
  filterVisibilityChange,
  persistedShownFilters,
  writePersisted,
} from "./dataTablePersistence.ts";
import type { DataTableFilterDefinition } from "./useDataTableFilterForm.ts";

export interface UseDataTableFilterVisibilityOptions {
  /**
   * What the table's filters are, as read at mount. `undefined` without
   * `filters`.
   */
  definition: DataTableFilterDefinition | undefined;
  /**
   * The key the filters facet is persisted under, or `undefined` when the
   * table does not store it. The shown filters sit behind the same facet as
   * the values: a table that forgets what the reader filtered by forgets what
   * they put on the bar with it.
   */
  filtersKey: string | undefined;
}

const NO_MODES = {};

/**
 * Which filters are on the bar: the table's state, not the bar's, because
 * three things write it - the bar (add, remove), Reset filters, and
 * persistence.
 *
 * Stored under `persistenceKey` as `filterVisibility`, and written on the
 * reader's acts only, never on mount: the rule every other persisted facet
 * follows. A filter that joined the bar because it holds a value is not the
 * reader choosing anything, and `setShown` with `act: false` stores nothing.
 */
export const useDataTableFilterVisibility = (
  options: UseDataTableFilterVisibilityOptions,
) => {
  const { definition, filtersKey } = options;
  const modes = definition?.modes ?? NO_MODES;

  const [shown, setShownState] = useState<string[]>(() =>
    persistedShownFilters(filtersKey, modes),
  );

  const declared = useMemo(() => declaredShownFilters(modes), [modes]);

  const setShown = useCallback(
    (next: string[], act: boolean) => {
      setShownState(next);
      if (act && filtersKey) {
        writePersisted(
          filtersKey,
          "filterVisibility",
          filterVisibilityChange(next, modes),
        );
      }
    },
    [filtersKey, modes],
  );

  /**
   * Back to the declaration: every optional filter off, every default one
   * on, and nothing stored.
   */
  const resetShown = useCallback(() => {
    setShownState(declared);
    if (filtersKey) writePersisted(filtersKey, "filterVisibility", undefined);
  }, [declared, filtersKey]);

  /**
   * Re-read for a scope that just changed under a mounted table. Called from
   * `DataTable`'s render-time scope block, with the other facets, and for
   * the same reason: an effect would leave the incoming project showing the
   * bar of the one just left.
   */
  const rereadShown = useCallback(
    (key: string | undefined) => {
      setShownState(persistedShownFilters(key, modes));
    },
    [modes],
  );

  /**
   * Whether the bar is somewhere Reset would move it from: an optional
   * filter added, or a default one removed. Order alone is not a difference:
   * the bar draws the filters in the order they joined it, and the same set
   * in another order is not worth a Reset.
   */
  const differsFromDeclaration =
    shown.length !== declared.length ||
    declared.some((key) => !shown.includes(key));

  return { shown, setShown, resetShown, rereadShown, differsFromDeclaration };
};
