import { type Alepha, type ZObject, z } from "alepha";
import type { FormModel } from "alepha/react/form";
import type { I18nProvider } from "alepha/react/i18n";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { Toast } from "../core/useToast.tsx";
import type { AlephaTableBaseProps } from "./alephaTableBaseProps.ts";
import { writePersisted } from "./alephaTablePersistence.ts";
import type { AlephaTableSource } from "./alephaTableTypes.ts";
import { cleanFilterValues, shareFiltersUrl } from "./queryFilters.ts";

export interface UseAlephaTableRefreshOptions<T> {
  props: AlephaTableBaseProps<T> & AlephaTableSource<T>;
  form: FormModel<ZObject> | undefined;
  /**
   * The key the filter values are persisted under, or `undefined` when the
   * table does not store them.
   */
  filtersKey: string | undefined;
  alepha: Alepha;
  toast: Toast;
  tr: I18nProvider<any, any>["tr"];
  setPage: Dispatch<SetStateAction<number>>;
  setRefreshKey: Dispatch<SetStateAction<number>>;
  setIsRefreshing: Dispatch<SetStateAction<boolean>>;
}

/**
 * What makes `AlephaTable` fetch again, and the filter actions that sit
 * beside it: the refresh button and `refreshSignal`, filter reset and share,
 * the filter form's submit and change events (with the filter persistence
 * they drive), and polling.
 *
 * It owns no row state. The page and the refresh key it writes belong to
 * `useAlephaTableData`.
 */
export const useAlephaTableRefresh = <T>(
  options: UseAlephaTableRefreshOptions<T>,
) => {
  const {
    props,
    form,
    filtersKey,
    alepha,
    toast,
    tr,
    setPage,
    setRefreshKey,
    setIsRefreshing,
  } = options;

  // -- Refresh + reset wiring -----------------------------------------------

  const refresh = useCallback(() => {
    setPage(0);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRefreshClick = useCallback(() => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [refresh]);

  // React to the external `refreshSignal` prop. The first render seeds the
  // ref without refetching (the mount effect already loads); every later
  // change triggers a refresh. Kept separate from `load`'s deps so an inline
  // `fetch` closure can't self-trigger a loop (see `fetchRef` above).
  const refreshSignalRef = useRef(props.refreshSignal);
  useEffect(() => {
    if (refreshSignalRef.current === props.refreshSignal) return;
    refreshSignalRef.current = props.refreshSignal;
    refresh();
  }, [props.refreshSignal, refresh]);

  const resetFilters = useCallback(() => {
    if (!form || !props.filters) return;
    // Per-field `.set(undefined)` is necessary: `setInitialValues({})`
    // doesn't emit `form:change` for deleted keys, so inputs stay
    // visually populated and subscribers don't refetch. Explicit set
    // keeps everyone in sync.
    const keys = Object.keys(z.schema.shape(props.filters.schema));
    for (const key of keys) {
      const input = (form.input as Record<string, { set?: (v: any) => void }>)[
        key
      ];
      input?.set?.(undefined);
    }
  }, [form, props.filters]);

  /**
   * Copy a link that opens this table with these filters.
   *
   * The write half of `fromQuery`, and the only one: nothing puts the
   * filters in the address bar as the reader types, so a link out of a
   * filtered table has to be asked for. Built on the page's own URL, so the
   * params the page owns travel with it.
   */
  /**
   * Whether a link out of this table would do anything on arrival.
   *
   * A table that does not read the query back would copy a URL whose params
   * are inert, which is worse than no Share at all: it looks like it worked.
   */
  const canShare = Boolean(props.filters?.fromQuery);

  const shareFilters = useCallback(async () => {
    if (!props.filters || !form) return;
    const url = shareFiltersUrl(
      window.location.href,
      Object.keys(z.schema.shape(props.filters.schema)),
      cleanFilterValues(form.currentValues ?? {}),
    );
    try {
      await navigator.clipboard.writeText(url);
      toast.success(
        tr("alephaTable.shareFiltersCopied", { default: "Link copied" }),
      );
    } catch {
      // A denied clipboard permission, or an insecure origin. Nothing here
      // is worth an error toast the reader cannot act on.
    }
  }, [form, props.filters, toast, tr]);

  // -- Form event subscriptions ---------------------------------------------

  // Refetch on explicit submit (manual Apply, programmatic submit, etc.).
  useEffect(() => {
    if (!form) return;
    return alepha.events.on("form:submit:success", (event) => {
      if (event.id !== form.id) return;
      setPage(0);
      setRefreshKey((k) => k + 1);
    });
  }, [alepha, form]);

  // Refetch on change (debounced) when autoApplyFilters is on. Default
  // is on whenever AlephaTable owns the form (`filters` prop).
  const autoApply = props.autoApplyFilters ?? Boolean(props.filters);
  useEffect(() => {
    if (!form || !autoApply) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsub = alepha.events.on("form:change", (event) => {
      if (event.id !== form.id) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        setPage(0);
        setRefreshKey((k) => k + 1);
      }, 250);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsub();
    };
  }, [alepha, form, autoApply]);

  // Persist filter values to localStorage on change.
  useEffect(() => {
    if (!filtersKey || !form || !props.filters) return;
    const writeFilters = () => {
      writePersisted(
        filtersKey,
        "filters",
        cleanFilterValues(form.currentValues ?? {}),
      );
    };
    const unsubs = [
      alepha.events.on("form:change", (event) => {
        if (event.id !== form.id) return;
        writeFilters();
      }),
      alepha.events.on("form:submit:success", (event) => {
        if (event.id !== form.id) return;
        writeFilters();
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [alepha, form, props.filters, filtersKey]);

  // -- Polling ---------------------------------------------------------------

  useEffect(() => {
    if (!props.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setRefreshKey((k) => k + 1);
    }, props.pollMs);
    return () => clearInterval(id);
  }, [props.pollMs]);

  return { refresh, handleRefreshClick, resetFilters, canShare, shareFilters };
};
