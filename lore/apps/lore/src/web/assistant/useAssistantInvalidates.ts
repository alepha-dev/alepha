import { aiContextAtom } from "@alepha/ui/ai";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useCallback } from "react";

/**
 * The writes whose success changes the page beside the dock (#Q3210).
 */
const WRITES = new Set([
  "quest_create",
  "quest_comment_add",
  "quest_update",
  "quest_complete",
  "folio_create",
]);

/**
 * What refreshes the page after the assistant wrote (#Q3210), in two halves:
 *
 * - `invalidates`: the keyed reads of the project, the quest list and its
 *   tags, refetched after any turn that ran a tool;
 * - `onToolsRan`: Lore's project pages mostly read loader-filled atoms, not
 *   query keys, so after a confirmed write the current route's loaders run
 *   again (`router.invalidate()`), which is what reloading the page would
 *   do, without the reload. Reads change nothing and skip it.
 */
export const useAssistantInvalidates = (): {
  invalidates: unknown[][];
  onToolsRan: (names: string[]) => void;
} => {
  const router = useRouter<any>();
  const [contexts] = useStore(aiContextAtom);
  const projectId = (
    contexts?.at(-1)?.data as { projectId?: number } | undefined
  )?.projectId;

  const onToolsRan = useCallback(
    (names: string[]) => {
      if (names.some((name) => WRITES.has(name))) {
        void router.invalidate();
      }
    },
    [router],
  );

  return {
    invalidates:
      projectId === undefined
        ? []
        : [
            ["quests", projectId],
            ["quest-tags", projectId],
          ],
    onToolsRan,
  };
};
