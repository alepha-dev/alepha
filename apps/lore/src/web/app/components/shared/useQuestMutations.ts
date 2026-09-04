import { useAlepha, useClient } from "alepha/react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentQuestCountAtom } from "@/web/app/atoms/currentQuestCountAtom.ts";

import { type BulkOutcome, settleBulk } from "./bulkOutcome.ts";

/**
 * The five quest transitions, plus the bookkeeping the two sidebar atoms
 * need, in one place.
 *
 * Three surfaces run these - the table, the detail view and the kanban
 * board - and each had grown its own partial answer to "what else changed".
 * The table refreshed the open count and forgot the assigned list; the view
 * updated the assigned list and forgot the count; the board did half of one
 * and none of the other. So the sidebar badge and the Quest Log lagged
 * behind whichever surface you happened to act from, until a navigation
 * re-ran the project loader and quietly corrected them.
 *
 * ## Which atom each transition moves, and why
 *
 * `currentAssignedQuestsAtom` is "not completed, and accepted by me"
 * (`ProjectController.getProjectBySlug`). So accept adds, unassign and
 * complete remove - and **shelve does not touch it**: the server's own
 * query does not filter `shelvedAt`, so a shelved quest you hold is still
 * yours. Removing it here would make the atom disagree with the list the
 * next navigation fetches.
 *
 * `currentQuestCountAtom` is `OpenQuestScope`: not completed, not shelved,
 * and past the planned-epic backlog gate. So complete, shelve, unshelve and
 * delete move it, and accept and unassign do not.
 *
 * ## Why the count is refetched rather than adjusted
 *
 * A local `count - 1` would be wrong for any quest behind the backlog gate,
 * which is not counted in the first place - the caller cannot know whether
 * the quest it just closed was in the number without re-deriving the gate.
 * One request, on the transitions that actually move it. The table already
 * paid it; the other two now do too.
 *
 * Confirmation dialogs stay with the callers: the shelve warning needs the
 * questline, which the detail view already holds and the table has to fetch
 * on click, and folding that in would make the hook the worse of the two.
 */
export const useQuestMutations = (): QuestMutations => {
  const alepha = useAlepha();
  const questApi = useClient<QuestController>();

  const dropFromAssigned = (id: number): void => {
    alepha.store.set(
      currentAssignedQuestsAtom,
      (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
        (q) => q.id !== id,
      ),
    );
  };

  const addToAssigned = (quest: QuestResource): void => {
    const current = alepha.store.get(currentAssignedQuestsAtom) ?? [];
    // Guarded against a double-add: accepting from the board runs a second
    // request (the sub-column move) and a caller may re-run this path.
    if (current.some((q) => q.id === quest.id)) return;
    alepha.store.set(currentAssignedQuestsAtom, [...current, quest]);
  };

  const refreshCount = async (): Promise<void> => {
    const projectId = alepha.store.get(currentProjectAtom)?.id;
    if (!projectId) return;
    // Swallowed: the badge is chrome. A transient failure must cost the
    // number, not the action the user just took successfully.
    await questApi
      .countOpenQuests({ params: { projectId } })
      .then(({ count }) => alepha.store.set(currentQuestCountAtom, { count }))
      .catch(() => null);
  };

  // `settleBulk` used to be a local `settle` here. It moved to
  // `bulkOutcome.ts` when the Epics list grew the same selection bar
  // (feedback #2086) - the behaviour is unchanged, and the alias keeps the
  // call sites below reading as they did.
  const settle = settleBulk;

  return {
    accept: async (id) => {
      const quest = await questApi.acceptQuest({ params: { id } });
      addToAssigned(quest);
      return quest;
    },
    unassign: async (id) => {
      // Still `abandonQuest` on the server: it clears `acceptedAt` /
      // `acceptedBy` / the kanban column and pushes an `unassigned` history
      // event, and has never deleted anything.
      const quest = await questApi.abandonQuest({ params: { id } });
      dropFromAssigned(id);
      return quest;
    },
    complete: async (id, body) => {
      const quest = await questApi.completeQuest({ params: { id }, body });
      dropFromAssigned(id);
      await refreshCount();
      return quest;
    },
    shelve: async (id) => {
      const quest = await questApi.shelveQuest({ params: { id } });
      await refreshCount();
      return quest;
    },
    unshelve: async (id) => {
      const quest = await questApi.unshelveQuest({ params: { id } });
      await refreshCount();
      return quest;
    },
    remove: async (id) => {
      await questApi.deleteQuest({ params: { id } });
      // A deleted quest leaves both: it is neither open nor anybody's.
      dropFromAssigned(id);
      await refreshCount();
    },
    shelveMany: async (ids) => {
      const outcome = await settle(ids, (id) =>
        questApi.shelveQuest({ params: { id } }),
      );
      await refreshCount();
      return outcome;
    },
    unshelveMany: async (ids) => {
      const outcome = await settle(ids, (id) =>
        questApi.unshelveQuest({ params: { id } }),
      );
      await refreshCount();
      return outcome;
    },
    removeMany: async (ids) => {
      const outcome = await settle(ids, (id) =>
        questApi.deleteQuest({ params: { id } }),
      );
      for (const id of outcome.done) {
        dropFromAssigned(id);
      }
      await refreshCount();
      return outcome;
    },
    attachToRelease: async (ids, releaseId) => {
      // A quest update carrying `releaseId`, the same write the quest rail
      // and the epic page make. No atom moves: membership in a release is
      // not part of the open count or the assigned list.
      return settle(ids, (id) =>
        questApi.updateQuestById({ params: { id }, body: { releaseId } }),
      );
    },
    refreshCount,
  };
};

export interface QuestMutations {
  accept: (id: number) => Promise<QuestResource>;
  unassign: (id: number) => Promise<QuestResource>;
  complete: (id: number, body: CompleteQuestBody) => Promise<QuestResource>;
  shelve: (id: number) => Promise<QuestResource>;
  unshelve: (id: number) => Promise<QuestResource>;
  remove: (id: number) => Promise<void>;
  /**
   * The bulk forms of shelve, unshelve and delete: one call per id, all at
   * once, the atoms moved once for the whole batch, and every refusal
   * reported rather than thrown. The caller decides what to do with a
   * selection that mixes eligible and ineligible rows; these send what they
   * are given.
   */
  shelveMany: (ids: number[]) => Promise<BulkOutcome>;
  unshelveMany: (ids: number[]) => Promise<BulkOutcome>;
  removeMany: (ids: number[]) => Promise<BulkOutcome>;
  /**
   * Attach every id to one release. Refused server-side for a published
   * release, which is why the caller only ever offers open ones.
   */
  attachToRelease: (ids: number[], releaseId: number) => Promise<BulkOutcome>;
  /**
   * Re-derive the open-quest badge. Exposed for the one caller that changes
   * the number without going through a transition here - the table's own
   * bulk paths.
   */
  refreshCount: () => Promise<void>;
}

/**
 * What closing a quest may carry: the summary of what was done, and a
 * reason per objective being closed without having been done.
 */
export interface CompleteQuestBody {
  message?: string;
  waive?: Array<{ objectiveId: number; reason: string }>;
}
