import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { type RefObject, useEffect, useRef } from "react";

export interface UseDataTableWakeOptions {
  /**
   * `refreshOnFocus`: off unless the table asks.
   */
  enabled: boolean;
  /**
   * Bumped each time a response lands: the moment the rows on screen were
   * read, which a return within {@link UseDataTableWakeOptions.freshMs}
   * does not repeat.
   */
  loadedRequestId: number;
  /**
   * How long rows stay fresh after a load, in milliseconds.
   */
  freshMs: number;
  /**
   * Rows are checked: a reload could drop the ones the reader picked.
   */
  selecting: boolean;
  /**
   * The table's root, to tell an edit in progress: focus in a field inside
   * it.
   */
  root: RefObject<HTMLElement | null>;
  /**
   * Reload where the reader is: the page, sort, filters and rows on screen
   * stay until the new rows land, no skeleton.
   */
  reload: () => void;
}

/**
 * `DataTable`'s tab-return refresh (#Q4069): reload in the background when
 * the page becomes visible again, the signal `useQuery`'s `refetchOnFocus`
 * listens to (`visibilitychange` to visible, `QueryWakeEvents`), not the
 * window's `focus`, which a click back from the devtools also fires.
 *
 * Nothing is sent when the rows were read within `freshMs`, so tabbing back
 * and forth costs nothing, nor while rows are selected or a field inside the
 * table has focus: a reload under an edit would throw it away.
 */
export const useDataTableWake = (options: UseDataTableWakeOptions) => {
  const dateTime = useInject(DateTimeProvider);
  const loadedAt = useRef(dateTime.nowMillis());
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    loadedAt.current = dateTime.nowMillis();
  }, [options.loadedRequestId, dateTime]);

  useEffect(() => {
    if (!options.enabled || typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) return;
      const current = latest.current;
      if (dateTime.nowMillis() - loadedAt.current < current.freshMs) return;
      if (current.selecting) return;
      const focused = document.activeElement;
      if (
        focused &&
        current.root.current?.contains(focused) &&
        (focused.matches("input, textarea, select") ||
          (focused as HTMLElement).isContentEditable)
      ) {
        return;
      }
      current.reload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [options.enabled, dateTime]);
};
