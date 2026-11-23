import { type ToastIntent, type UndoableApplied, useToast } from "@alepha/ui";
import { ActionErrorPolicy, useAlepha } from "alepha/react";
import { useMemo } from "react";

export interface OptimisticWriteOptions {
  /**
   * The toast shown once the server accepted the write, in the past tense
   * ("#Q12 shelved"). No toast without one.
   */
  message?: string;
  description?: string;
  /**
   * Defaults to "success".
   */
  intent?: ToastIntent;
  /**
   * The local change, made at once, before any request: hide a row, patch a
   * status chip. Returns how to roll it back, as a `DataTable` row handle
   * (`ctx.optimistic.remove`) does.
   */
  apply?: () => UndoableApplied;
  /**
   * The server write, sent at once.
   */
  commit: () => Promise<unknown>;
  /**
   * After the server accepted `commit`. Refresh what depends on it here.
   */
  onCommitted?: () => void;
}

export interface OptimisticWrite {
  /**
   * Never rejects: a failure is rolled back and reported on
   * `react:action:error`, which the root `ActionErrorToaster` shows.
   */
  run: (options: OptimisticWriteOptions) => Promise<boolean>;
}

/**
 * An optimistic write with no Undo: the screen changes in the click's own
 * frame, the request leaves at once, and a failure puts the screen back.
 *
 * Lore dropped `useUndoable`'s Undo toast: nobody clicked Undo, and its
 * deferred mode held every delete for the toast's six seconds. A delete is
 * guarded by its confirm, a shelve or a status change by its inverse in the
 * row menu.
 *
 * Call it straight from the click, not from inside a `useAction`: the change
 * must reach the screen in the click's own frame, and `useAction` awaits its
 * `react:action:begin` listeners before the handler starts.
 */
export const useOptimisticWrite = (): OptimisticWrite => {
  const alepha = useAlepha();
  const toast = useToast();

  return useMemo(() => {
    const run = async (options: OptimisticWriteOptions): Promise<boolean> => {
      const applied = options.apply?.();
      try {
        await options.commit();
      } catch (error) {
        if (typeof applied === "function") applied();
        else applied?.rollback();
        void alepha.events.emit("react:action:error", {
          type: "custom",
          id: "optimistic-write",
          error: error as Error,
          handled: ActionErrorPolicy.isHandled(error),
        });
        return false;
      }
      if (applied && typeof applied === "object") applied.settle?.();
      options.onCommitted?.();
      if (options.message) {
        toast.show(options.message, options.intent ?? "success", {
          description: options.description,
        });
      }
      return true;
    };
    return { run };
  }, [alepha, toast]);
};
