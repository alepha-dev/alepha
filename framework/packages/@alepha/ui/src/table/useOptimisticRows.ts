import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * How long a removed row plays its exit before it leaves the DOM. Matches
 * `useRowMotion`'s exit animation.
 */
const LEAVE_MS = 200;

/**
 * What a row action gets back from `ctx.optimistic`: how to put the row back,
 * and how to say the server agreed. `useUndoable`'s `apply` accepts it as is.
 */
export interface OptimisticHandle {
  /**
   * The write failed or was undone: the row comes back as it was.
   */
  rollback: () => void;
  /**
   * The server accepted the write. The table reloads the page in place and
   * lets go of the overlay once that reload has answered, so the row never
   * flickers back between the two.
   */
  settle: () => void;
}

/**
 * The optimistic verbs a row or bulk action receives on its context.
 */
export interface OptimisticRows<T> {
  /**
   * Take rows off the page now: they play their exit, the rows below close
   * the gap.
   */
  remove: (items: T | T[]) => OptimisticHandle;
  /**
   * Draw a row as `next` now (a new status chip, a new assignee). The row
   * flashes so the eye finds what changed.
   */
  patch: (item: T, next: T) => OptimisticHandle;
}

type Entry<T> =
  | { kind: "remove"; leaving: boolean; settledAfter?: number }
  | { kind: "patch"; value: T; settledAfter?: number }
  /**
   * A removed row put back after the server already dropped it from the
   * page (an Undo after the settle): drawn at its old index until a reload
   * says where it really goes.
   */
  | { kind: "restore"; value: T; index: number; settledAfter?: number };

export interface UseOptimisticRowsOptions<T> {
  data: T[];
  rowKeys: string[];
  rowKey: (item: T) => string;
  /**
   * The id of the request whose rows are on screen.
   */
  loadedRequestId: number;
  /**
   * The id of the newest request sent.
   */
  lastRequestId: () => number;
  reload: () => void;
  /**
   * Static mode: the caller owns the rows, so a settled overlay goes at once.
   */
  isStatic: boolean;
}

/**
 * The layer between the rows the server sent and the rows on screen.
 *
 * An entry hides or redraws one row by key until it is rolled back or
 * settled. A settled entry waits for a request that left AFTER the settle,
 * because one that left before still carries the old row.
 */
export const useOptimisticRows = <T>(options: UseOptimisticRowsOptions<T>) => {
  const { data, rowKeys, loadedRequestId, lastRequestId, reload, isStatic } =
    options;
  const [allEntries, setEntries] = useState<ReadonlyMap<string, Entry<T>>>(
    () => new Map(),
  );
  // Rows flashed by a patch, cleared by `useRowMotion` once played.
  const flashRef = useRef(new Set<string>());

  // The newest answered request, for the writers below: an entry settled
  // before it is dead. Kept in a ref, written after render, because the
  // writers run from clicks long after the render that created them.
  const loadedRef = useRef(loadedRequestId);
  useEffect(() => {
    loadedRef.current = loadedRequestId;
  }, [loadedRequestId]);

  // The pending end-of-exit timers. Cleared on unmount: a table that is gone
  // must not take a state update from a row that was leaving it.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /**
   * Every write starts by dropping the dead entries, so a rollback sees a
   * settled row as gone and puts it back by hand.
   */
  const update = useCallback(
    (fn: (next: Map<string, Entry<T>>) => void) =>
      setEntries((prev) => {
        const next = new Map(prev);
        for (const [key, entry] of next) {
          if (!isLive(entry, loadedRef.current)) next.delete(key);
        }
        fn(next);
        return next;
      }),
    [],
  );

  const handleFor = useCallback(
    (
      keys: string[],
      originals?: Map<string, { item: T; index: number }>,
    ): OptimisticHandle => ({
      rollback: () =>
        update((next) => {
          for (const key of keys) {
            const entry = next.get(key);
            const original = originals?.get(key);
            // Still hidden by this overlay: lifting it is enough. Gone (the
            // settle already let go, the server page no longer has it): put
            // it back by hand, so Undo is as instant as the click was.
            if (!entry && original) {
              next.set(key, {
                kind: "restore",
                value: original.item,
                index: original.index,
              });
            } else {
              next.delete(key);
            }
          }
        }),
      settle: () => {
        if (isStatic) {
          update((next) => {
            for (const key of keys) next.delete(key);
          });
          return;
        }
        const after = lastRequestId();
        update((next) => {
          for (const key of keys) {
            const entry = next.get(key);
            if (entry) next.set(key, { ...entry, settledAfter: after });
          }
        });
        reload();
      },
    }),
    [update, isStatic, lastRequestId, reload],
  );

  const remove = useCallback(
    (items: T | T[]): OptimisticHandle => {
      const list = Array.isArray(items) ? items : [items];
      const keys = list.map(options.rowKey);
      const originals = new Map<string, { item: T; index: number }>();
      list.forEach((item, i) =>
        originals.set(keys[i], { item, index: rowKeys.indexOf(keys[i]) }),
      );
      update((next) => {
        for (const key of keys)
          next.set(key, { kind: "remove", leaving: true });
      });
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        update((next) => {
          for (const key of keys) {
            const entry = next.get(key);
            if (entry?.kind === "remove") {
              next.set(key, { ...entry, leaving: false });
            }
          }
        });
      }, LEAVE_MS);
      timers.current.add(timer);
      return handleFor(keys, originals);
    },
    [update, handleFor, options.rowKey, rowKeys],
  );

  const patch = useCallback(
    (item: T, value: T): OptimisticHandle => {
      const key = options.rowKey(item);
      flashRef.current.add(key);
      update((next) => {
        next.set(key, { kind: "patch", value });
      });
      return handleFor([key]);
    },
    [update, handleFor, options.rowKey],
  );

  // A settled entry lets go once a request sent after the settle has
  // answered: the server's rows are the truth again. Derived here rather
  // than deleted by an effect, so no render shows the stale overlay.
  const view = useMemo(() => {
    const entries = new Map(
      [...allEntries].filter(([, entry]) => isLive(entry, loadedRequestId)),
    );
    if (entries.size === 0) {
      return { data, rowKeys, leaving: EMPTY };
    }
    const outData: T[] = [];
    const outKeys: string[] = [];
    const leaving = new Set<string>();
    data.forEach((item, index) => {
      const key = rowKeys[index];
      const entry = entries.get(key);
      if (entry?.kind === "remove") {
        if (!entry.leaving) return;
        leaving.add(key);
      }
      outData.push(entry?.kind === "patch" ? entry.value : item);
      outKeys.push(key);
    });
    // Restored rows the server page does not hold (yet), at their old index.
    const present = new Set(rowKeys);
    const restores = [...entries]
      .filter(([key, e]) => e.kind === "restore" && !present.has(key))
      .sort(([, a], [, b]) =>
        a.kind === "restore" && b.kind === "restore" ? a.index - b.index : 0,
      );
    for (const [key, entry] of restores) {
      if (entry.kind !== "restore") continue;
      const at = Math.max(0, Math.min(entry.index, outData.length));
      outData.splice(at, 0, entry.value);
      outKeys.splice(at, 0, key);
    }
    return { data: outData, rowKeys: outKeys, leaving };
  }, [data, rowKeys, allEntries, loadedRequestId]);

  const optimistic: OptimisticRows<T> = useMemo(
    () => ({ remove, patch }),
    [remove, patch],
  );

  return { ...view, flash: flashRef.current, optimistic };
};

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Whether an entry still overrides the server's row: never settled, or
 * settled and still waiting for a request sent after it to answer.
 */
const isLive = (
  entry: { settledAfter?: number },
  loadedRequestId: number,
): boolean =>
  entry.settledAfter === undefined || loadedRequestId <= entry.settledAfter;
