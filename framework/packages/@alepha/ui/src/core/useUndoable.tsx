import { ActionErrorPolicy, useAlepha } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import { type ToastIntent, useToast } from "./useToast.tsx";

/**
 * What `apply` hands back: how to put the screen back, and optionally how to
 * say the server agreed. A `DataTable` row handle (`ctx.optimistic.remove`)
 * has this shape, so it can be returned as is.
 */
export type UndoableApplied =
  | void
  | (() => void)
  | { rollback: () => void; settle?: () => void };

export interface UndoableOptions {
  /**
   * The toast's message, in the past tense: the change has happened as far
   * as the reader can see ("Task archived").
   */
  message: string;
  description?: string;
  /**
   * Defaults to "success".
   */
  intent?: ToastIntent;
  /**
   * Defaults to the translated "Undo".
   */
  undoLabel?: string;
  /**
   * How long the toast, and with it the undo window, stays. Defaults to
   * 6000 ms.
   */
  duration?: number;
  /**
   * The local change, made at once, before any request: hide a row, patch a
   * status chip, move a counter. Returns how to roll it back.
   */
  apply?: () => UndoableApplied;
  /**
   * The server write.
   */
  commit: () => Promise<unknown>;
  /**
   * The server write that cancels `commit`, when there is one (unarchive for
   * archive). Its presence picks the mode:
   *
   * - **with `undo`**: `commit` is sent now, and Undo sends `undo`. The
   *   server is the truth from the first second, other tabs and agents see
   *   it, and closing the tab loses nothing.
   * - **without**: `commit` is held until the toast closes, and Undo simply
   *   never sends it. The mode for a write with no inverse (a hard delete).
   *   A held write is flushed when the page is hidden, so leaving does not
   *   cancel it.
   */
  undo?: () => Promise<unknown>;
  /**
   * After the server accepted `commit` (immediately, or once the window
   * closed). Refresh what depends on it here: a badge, a sibling list.
   */
  onCommitted?: () => void;
  /**
   * After the change was undone, locally and (with `undo`) on the server.
   */
  onUndone?: () => void;
}

/**
 * Optimistic writes with an Undo toast.
 *
 * `run` applies the local change at once, shows a toast with an Undo button,
 * and either commits now (`undo` given) or when the window closes. It
 * resolves once the change is visible and, in immediate mode, accepted.
 *
 * Call it straight from the click, not from inside a `useAction`: the
 * change must reach the screen in the click's own frame, and `useAction`
 * awaits its `react:action:begin` listeners before the handler starts. `run`
 * reports its own failures (rolled back, then `react:action:error`, which
 * the root `ActionErrorToaster` shows). `Ctrl+Z` / `Cmd+Z` undoes the newest
 * open toast.
 */
export const useUndoable = (): Undoable => {
  const alepha = useAlepha();
  const toast = useToast();
  const { tr } = useI18n();

  return useMemo(() => {
    const report = (error: unknown) => {
      void alepha.events.emit("react:action:error", {
        type: "custom",
        id: "undoable",
        error: error as Error,
        handled: ActionErrorPolicy.isHandled(error),
      });
    };

    const run = async (options: UndoableOptions): Promise<UndoableResult> => {
      const applied = options.apply?.();
      const rollback = () => {
        if (typeof applied === "function") applied();
        else applied?.rollback();
      };
      const settle = () => {
        if (applied && typeof applied === "object") applied.settle?.();
      };
      const immediate = Boolean(options.undo);

      // Immediate mode: the write leaves now. Undo waits for it, so an Undo
      // clicked while it is in flight sends the inverse after, never before.
      let committing: Promise<boolean> | undefined;

      const entry = UNDO_QUEUE.open({
        undo: async () => {
          if (committing && !(await committing)) return;
          rollback();
          if (immediate) {
            try {
              await options.undo!();
            } catch (error) {
              // The server kept the change: the screen must say so too.
              options.apply?.();
              report(error);
              return;
            }
            settle();
          }
          options.onUndone?.();
        },
        commit: immediate
          ? undefined
          : async () => {
              try {
                await options.commit();
              } catch (error) {
                rollback();
                report(error);
                return;
              }
              settle();
              options.onCommitted?.();
            },
      });

      // The toast goes up with the change, not after the server: it is the
      // acknowledgement of the click.
      const id = toast.show(options.message, options.intent ?? "success", {
        description: options.description,
        duration: options.duration ?? 6000,
        action: {
          label: options.undoLabel ?? tr("undoable.undo", { default: "Undo" }),
          onClick: () => void UNDO_QUEUE.undo(entry),
        },
        onAutoClose: () => void UNDO_QUEUE.close(entry),
        onDismiss: () => void UNDO_QUEUE.close(entry),
      });
      entry.dismiss = () => toast.dismiss(id);

      if (!immediate) return { ok: true };

      let failure: unknown;
      committing = options.commit().then(
        () => true,
        (error: unknown) => {
          failure = error;
          return false;
        },
      );
      if (!(await committing)) {
        UNDO_QUEUE.cancel(entry);
        rollback();
        report(failure);
        return { ok: false, reason: "error", error: failure };
      }
      settle();
      options.onCommitted?.();
      return { ok: true };
    };

    return { run };
  }, [alepha, toast, tr]);
};

export interface Undoable {
  /**
   * Never rejects: a failure is rolled back and reported on
   * `react:action:error` (the root `ActionErrorToaster` shows it), and the
   * result says so for a caller that has a follow-up.
   */
  run: (options: UndoableOptions) => Promise<UndoableResult>;
}

export type UndoableResult =
  | { ok: true }
  | { ok: false; reason: "error"; error: unknown };

/**
 * One open undo window.
 */
interface UndoEntry {
  undo: () => Promise<void>;
  /**
   * The held write, in deferred mode.
   */
  commit?: () => Promise<void>;
  dismiss?: () => void;
  done: boolean;
}

/**
 * The open undo windows, outside React: a held commit must still go out when
 * the component that started it unmounts (the reader navigated away), and
 * the page-hide flush and the keyboard shortcut are document-wide.
 */
class UndoQueue {
  protected entries: UndoEntry[] = [];
  protected listening = false;

  open(entry: Omit<UndoEntry, "done">): UndoEntry {
    const full: UndoEntry = { ...entry, done: false };
    this.entries.push(full);
    this.listen();
    return full;
  }

  async undo(entry: UndoEntry): Promise<void> {
    if (entry.done) return;
    entry.done = true;
    this.drop(entry);
    // The action click closes the toast already; the shortcut does not.
    entry.dismiss?.();
    await entry.undo();
  }

  /**
   * The write failed: the window closes with nothing to commit or undo.
   */
  cancel(entry: UndoEntry): void {
    if (entry.done) return;
    entry.done = true;
    this.drop(entry);
    entry.dismiss?.();
  }

  async close(entry: UndoEntry): Promise<void> {
    if (entry.done) return;
    entry.done = true;
    this.drop(entry);
    await entry.commit?.();
  }

  protected drop(entry: UndoEntry) {
    this.entries = this.entries.filter((e) => e !== entry);
  }

  protected listen() {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    // A held write goes out when the page is hidden: closing the tab inside
    // the window is "I meant it", not "undo".
    window.addEventListener("pagehide", () => {
      // No copy needed: `drop` replaces `entries` rather than splicing it,
      // so this loop walks the list as it was when the page went away.
      for (const entry of this.entries) void this.close(entry);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Text fields keep their own undo.
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const last = this.entries.at(-1);
      if (!last) return;
      event.preventDefault();
      void this.undo(last);
    });
  }
}

const UNDO_QUEUE = new UndoQueue();
