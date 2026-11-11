import { useAction, useAlepha, useClient } from "alepha/react";

import type { UserDockController } from "../../../../api/controllers/UserDockController.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";

/**
 * The dock's writes (#E139): reorder, pin and unpin, each a `useAction` run
 * that leaves `userDockAtom` holding what the server answered.
 *
 * `reorder` is optimistic: the caller has already drawn the new order (a drop
 * must land in its own frame), and hands the order it replaced so a refused
 * save puts it back. Pin and unpin wait for the answer: a pin can be refused
 * for a full dock, and the toast is the `ActionErrorToaster`'s.
 */
export const useDock = () => {
  const alepha = useAlepha();
  const api = useClient<UserDockController>();

  const reorder = useAction<[next: number[], previous: number[]], void>(
    {
      handler: async (_ctx, next, previous) => {
        try {
          const saved = await api.reorderDock({ body: { projectIds: next } });
          alepha.store.set(userDockAtom, saved.projectIds);
        } catch (error) {
          alepha.store.set(userDockAtom, previous);
          throw error;
        }
      },
    },
    [alepha, api],
  );

  const pin = useAction<[projectId: number], void>(
    {
      handler: async (_ctx, projectId) => {
        const saved = await api.pinProject({ params: { projectId } });
        alepha.store.set(userDockAtom, saved.projectIds);
      },
    },
    [alepha, api],
  );

  const unpin = useAction<[projectId: number], void>(
    {
      handler: async (_ctx, projectId) => {
        const saved = await api.unpinProject({ params: { projectId } });
        alepha.store.set(userDockAtom, saved.projectIds);
      },
    },
    [alepha, api],
  );

  /**
   * Draw `next` now and save it, putting the current order back on failure.
   */
  const move = (next: number[]) => {
    const previous = alepha.store.get(userDockAtom) ?? [];
    alepha.store.set(userDockAtom, next);
    return reorder.run(next, previous);
  };

  return { reorder, pin, unpin, move };
};
