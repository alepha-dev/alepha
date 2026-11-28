import { useDialog, useToast } from "@alepha/ui";
import type { DragEndEvent } from "@dnd-kit/core";
import { formatReference, type I18n } from "@lore/core/web";
import { useAction, useAlepha, useClient, useQueryClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { Dispatch, SetStateAction } from "react";

import type { EpicController } from "../../../../api/controllers/EpicController.ts";
import type { KanbanController } from "../../../../api/controllers/KanbanController.ts";
import type { QuestController } from "../../../../api/controllers/QuestController.ts";
import type { EpicRefResource } from "../../../../api/schemas/epicRefResourceSchema.ts";
import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { currentEpicCountAtom } from "../../atoms/currentEpicCountAtom.ts";
import { currentEpicsAtom } from "../../atoms/currentEpicsAtom.ts";
import { useQuestMutations } from "../shared/useQuestMutations.ts";
import type { ColumnDescriptor, ColumnKind } from "./KanbanColumn.tsx";
import { KanbanGrouping } from "./kanbanGrouping.ts";

/**
 * Stateless, so one instance serves every mount.
 */
const grouping = new KanbanGrouping();

export interface KanbanMoveInput {
  quests: QuestResource[];
  setQuests: Dispatch<SetStateAction<QuestResource[]>>;
  /**
   * The whole board bucketed by column key, for the same-column checks.
   */
  grouped: Record<string, QuestResource[]>;
  columns: ColumnDescriptor[];
  /**
   * Where `acceptQuest` puts a quest server-side: the project's first
   * configured column.
   */
  acceptLandsIn: string;
  /**
   * A fresh board, after a move the server may have ranked differently.
   */
  reload: () => Promise<unknown>;
}

/**
 * One drop on the board, as one `useAction` (#E59, #Q2330).
 *
 * The drag is the gesture, so it is the action, not each request inside it:
 * a card dropped onto a card is a position within a column, and a drop onto
 * another column is a lifecycle move that may take two calls (accept, then
 * the sub-column). `handleCardDrop` stays an inner function because its
 * boolean decides whether the drop falls through to the column move, which a
 * `run()` resolving `undefined` could not carry.
 *
 * ⚠️ **The rollback lives in the handler, and it rethrows.** Both branches
 * paint optimistically and hold the snapshot they painted over; a refusal
 * restores exactly that snapshot and rethrows, and the rethrow is what the
 * root `ActionErrorToaster` shows. `onError` could not do it: it receives the
 * error and never the snapshot.
 *
 * `useQuestMutations` keeps rejecting (#E59 rule 2), so a failed `accept`
 * still stops the sub-column move that follows it.
 *
 * ## Draft (#Q4376)
 *
 * The Draft column is a lane like the others, with one door: To do. A loose
 * card dragged from Draft to To do is marked ready, and from To do to Draft
 * is marked draft. A draft dropped anywhere else is refused out loud, with
 * the reason: a draft cannot be taken, so it is marked ready first.
 *
 * A draft its epic owns never moves alone, because the epic's status decides
 * for all of its quests (#E178). Dropped on To do, the board offers to mark
 * the epic ready, naming how many of its cards go with it; confirmed, the
 * epic is marked ready (`setEpicStatus`) and every one of its drafts moves.
 * A to-do card of an epic dropped on Draft is refused, naming the epic,
 * whose page sends it back to draft.
 *
 * Extracted from `KanbanBoard` so the drop can be driven without a pointer:
 * dnd-kit resolves a drop from layout rects, which jsdom does not have.
 */
export const useKanbanMove = (input: KanbanMoveInput) => {
  const alepha = useAlepha();
  const questApi = useClient<QuestController>();
  const kanbanApi = useClient<KanbanController>();
  const epicApi = useClient<EpicController>();
  const queries = useQueryClient();
  const questMutations = useQuestMutations();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();

  return useAction<[event: DragEndEvent], void>(
    {
      handler: async (_ctx, event) => {
        const { quests, setQuests, grouped, columns, acceptLandsIn, reload } =
          input;

        /**
         * Drop onto another card: place the dragged card immediately above
         * it.
         *
         * Only within one column. A card dropped onto a card in a DIFFERENT
         * column falls through to the column handler below, because crossing
         * columns is a lifecycle transition first and a position second - and
         * answering both from one gesture would make an accept depend on
         * where in the lane the cursor happened to be.
         */
        const handleCardDrop = async (
          quest: QuestResource,
          target: QuestResource,
        ): Promise<boolean> => {
          const columnKey = Object.keys(grouped).find((key) =>
            grouped[key].some((row) => row.id === target.id),
          );
          const column = columnKey ? grouped[columnKey] : undefined;
          if (!column || !column.some((row) => row.id === quest.id)) {
            return false;
          }

          // Neighbours as they will be once the card has left its old slot,
          // which is what the server ranks between.
          const without = column.filter((row) => row.id !== quest.id);
          const targetIndex = without.findIndex((row) => row.id === target.id);
          if (targetIndex === -1) return false;
          const before = without[targetIndex - 1];
          const after = without[targetIndex];
          if (before?.id === quest.id) return false;

          // Optimistic: the card follows the cursor's release. Reordering used
          // to cost a full board refetch per drop, which blanked every column
          // for the length of a round trip.
          const previous = quests;
          const reordered = [...without];
          reordered.splice(targetIndex, 0, quest);
          setQuests((all) => [
            ...all.filter((row) => !reordered.some((r) => r.id === row.id)),
            ...reordered,
          ]);

          try {
            await kanbanApi.moveQuestOnBoard({
              params: { id: quest.id },
              body: { beforeQuestId: before?.id, afterQuestId: after?.id },
            });
          } catch (error) {
            setQuests(previous);
            throw error;
          }
          // The server is the authority on the rank it minted, and the ranks
          // it may have just backfilled across the rest of the column - so
          // take a fresh board rather than trusting the local splice.
          await reload();
          return true;
        };

        /**
         * The epic a card belongs to, as a ref, for the sentences that name
         * it. Read from the project's snapshot, whose numbers never change,
         * and fetched only for an epic created after it was taken.
         */
        const epicRefOf = async (
          quest: QuestResource,
        ): Promise<EpicRefResource | undefined> => {
          if (quest.epicId == null) return undefined;
          const known = alepha.store
            .get(currentEpicsAtom)
            ?.find((epic) => epic.id === quest.epicId);
          if (known) return known;
          const fresh = await epicApi.getEpicRefs({
            params: { projectId: quest.projectId },
          });
          return fresh.find((epic) => epic.id === quest.epicId);
        };

        /**
         * Mark the card's epic ready, after asking: it moves every one of the
         * epic's drafts, on a board other people are looking at too.
         */
        const readyEpic = async (
          quest: QuestResource,
          epic: EpicRefResource,
        ): Promise<void> => {
          const ref = formatReference("epic", epic.number);
          const drafts = quests.filter(
            (row) => row.epicId === epic.id && !!row.draftAt,
          );
          const count = drafts.length;
          const ok = await dialog.confirm({
            title: tr("kanban.draft.epicReady.title", { args: [ref] }),
            description: tr("kanban.draft.epicReady.description", {
              args: [ref, epic.title],
            }),
            confirmLabel:
              count === 1
                ? tr("kanban.draft.epicReady.confirm.one", { args: [ref] })
                : tr("kanban.draft.epicReady.confirm", {
                    args: [ref, String(count)],
                  }),
            cancelLabel: tr("common.cancel"),
          });
          if (!ok) return;

          // Optimistic: every draft of the epic leaves Draft at once, as the
          // server's one statement releases them. A held one stays held, in
          // To do, since its hold is untouched.
          const before = quests;
          const ids = new Set(drafts.map((row) => row.id));
          setQuests((prev) =>
            prev.map((row) =>
              ids.has(row.id)
                ? {
                    ...row,
                    draftAt: undefined,
                    metadata: {
                      ...row.metadata,
                      status:
                        row.metadata.status === "draft"
                          ? "todo"
                          : row.metadata.status,
                    },
                  }
                : row,
            ),
          );
          try {
            await epicApi.setEpicStatus({
              params: { id: epic.id },
              body: { status: "ready" },
            });
          } catch (error) {
            setQuests(before);
            throw error;
          }

          // What the epic pages do after the same write: the snapshot and
          // the sidebar's draft-epic badge follow, the epic and quest reads
          // are stale, and the open-quest badge now counts these quests.
          const snapshot = alepha.store.get(currentEpicsAtom);
          if (snapshot) {
            alepha.store.set(
              currentEpicsAtom,
              snapshot.map((row) =>
                row.id === epic.id ? { ...row, status: "ready" } : row,
              ),
            );
          }
          if (epic.status === "draft") {
            const badge = alepha.store.get(currentEpicCountAtom)?.count ?? 0;
            alepha.store.set(currentEpicCountAtom, {
              count: Math.max(0, badge - 1),
            });
          }
          queries.invalidate(["epics", quest.projectId]);
          queries.invalidate(["quests", quest.projectId]);
          await questMutations.refreshCount();
          await reload();
        };

        /**
         * A drop leaving Draft or entering it. To do is its one door; every
         * other way out is refused with the reason, never swallowed.
         */
        const handleDraftDrop = async (
          quest: QuestResource,
          toKind: ColumnKind,
        ): Promise<void> => {
          const epic = await epicRefOf(quest);
          const ref = epic ? formatReference("epic", epic.number) : undefined;

          if (grouping.laneOf(quest) === "draft") {
            if (toKind !== "todo") {
              toaster.show(
                ref
                  ? tr("kanban.draft.error.epicToTodo", { args: [ref] })
                  : tr("kanban.draft.error.toTodo"),
                "warning",
              );
              return;
            }
            if (epic) {
              await readyEpic(quest, epic);
              return;
            }
          } else {
            // Only a loose To do card goes to Draft: the refusal names what
            // stands in the way for this card, never a fix it does not need.
            if (quest.metadata.status !== "todo") {
              const status = quest.metadata.status;
              toaster.show(
                status === "in_progress"
                  ? tr("kanban.draft.error.fromTaken")
                  : status === "on_hold"
                    ? tr("kanban.draft.error.fromHeld")
                    : status === "completed"
                      ? tr("kanban.draft.error.fromCompleted")
                      : tr("kanban.draft.error.fromTodo"),
                "warning",
              );
              return;
            }
            if (ref) {
              toaster.show(
                tr("kanban.draft.error.epicOwns", { args: [ref] }),
                "warning",
              );
              return;
            }
          }

          // A loose card, one verb each way.
          const toDraft = toKind === "draft";
          const before = quests;
          setQuests((prev) =>
            prev.map((row) =>
              row.id === quest.id
                ? {
                    ...row,
                    // The reload brings the server's `draftAt`; the lane
                    // reads the status meanwhile.
                    ...(toDraft ? {} : { draftAt: undefined }),
                    kanbanColumn: undefined,
                    metadata: {
                      ...row.metadata,
                      status: toDraft ? "draft" : "todo",
                    },
                  }
                : row,
            ),
          );
          try {
            if (toDraft) await questMutations.draft(quest.id);
            else await questMutations.ready(quest.id);
          } catch (error) {
            setQuests(before);
            throw error;
          }
          await reload();
        };

        const { active, over } = event;
        if (!over) return;

        const questData = active.data.current;
        const columnData = over.data.current;
        if (questData?.type !== "quest") return;

        // Dropped onto another card - a position within a column.
        if (columnData?.type === "card") {
          const target = columnData.quest as QuestResource;
          const dragged = questData.quest as QuestResource;
          if (target.id === dragged.id) return;
          if (await handleCardDrop(dragged, target)) return;
          // Not a same-column drop: fall through and treat it as a drop on
          // the target's column, which is the lifecycle move it really is.
        }

        if (columnData?.type !== "column" && columnData?.type !== "card") {
          return;
        }

        const quest = questData.quest as QuestResource;
        const fromStatus = quest.metadata.status;
        // The lane, not the status: a held card reads `on_hold`, which no
        // column carries, and a held draft sits in Draft.
        const fromLane = grouping.laneOf(quest);
        // A column droppable names its own lane; a card droppable does not,
        // so read the lane off the card that was landed on.
        const target =
          columnData.type === "card"
            ? (columnData.quest as QuestResource)
            : undefined;
        const toKind = (target ? grouping.laneOf(target) : columnData.kind) as
          | ColumnKind
          | undefined;
        if (!toKind) return;
        const toSubColumn = (
          target ? target.kanbanColumn : columnData.subColumn
        ) as string | undefined;

        // No-op if the card was dropped onto its current column.
        if (fromLane === toKind) {
          if (toKind !== "in_progress") return;
          if (quest.kanbanColumn === toSubColumn) return;
        }

        if (fromLane === "draft" || toKind === "draft") {
          await handleDraftDrop(quest, toKind);
          return;
        }

        // WIP limits are SOFT (#1228). A hard block on your own board is a
        // tool arguing with you, so this warns and proceeds - the point of
        // the limit is to make the overload visible, not to police it.
        const targetColumn = columns.find(
          (col) => col.kind === toKind && col.subColumn === toSubColumn,
        );
        if (
          targetColumn?.wipLimit != null &&
          (grouped[targetColumn.key]?.length ?? 0) >= targetColumn.wipLimit &&
          // Only when the card is arriving from somewhere else: shuffling
          // within an already-full column does not make it fuller.
          !grouped[targetColumn.key]?.some((row) => row.id === quest.id)
        ) {
          toaster.show(
            tr("kanban.wip.exceeded", {
              args: [targetColumn.label, String(targetColumn.wipLimit)],
            }),
            "warning",
          );
        }

        // Done -> anywhere was a reopen, and reopen is gone (epic #E48): a
        // quest is immutable, and follow-up work is a NEW quest linked to the
        // old one.
        //
        // ⚠️ **Refused out loud, never swallowed.** Done cards are not
        // draggable at all, so this arm only catches the paths a drag block
        // cannot - and a card that snapped back in silence would read as a
        // bug rather than as a rule.
        if (fromStatus === "completed") {
          toaster.show(tr("kanban.error.completedCannotMove"), "warning");
          return;
        }

        if (fromStatus === "todo" && toKind === "completed") {
          toaster.show(tr("kanban.error.acceptFirst"), "warning");
          return;
        }

        // Optimistic: paint the destination before the round trip. The
        // reload still happens afterwards - a transition can change more
        // than the column (an accept stamps the assignee, a complete stamps
        // the timestamp) - but it is no longer what the eye is waiting for.
        const before = quests;
        setQuests((prev) =>
          prev.map((row) =>
            row.id === quest.id
              ? {
                  ...row,
                  metadata: { ...row.metadata, status: toKind },
                  kanbanColumn:
                    toKind === "in_progress" ? toSubColumn : undefined,
                }
              : row,
          ),
        );

        try {
          // Every branch goes through `useQuestMutations`, which owns what
          // each transition does to the Quest Log and the sidebar badge.
          if (fromStatus === "todo" && toKind === "in_progress") {
            // Accept the quest then (if needed) move it to the chosen
            // sub-column; acceptQuest drops it in the first column by default.
            await questMutations.accept(quest.id);
            if (toSubColumn && toSubColumn !== acceptLandsIn) {
              await questApi.setQuestKanbanColumn({
                params: { id: quest.id },
                body: { kanbanColumn: toSubColumn },
              });
            }
          } else if (fromStatus === "in_progress" && toKind === "todo") {
            await questMutations.unassign(quest.id);
          } else if (fromStatus === "in_progress" && toKind === "in_progress") {
            if (!toSubColumn) return;
            await questApi.setQuestKanbanColumn({
              params: { id: quest.id },
              body: { kanbanColumn: toSubColumn },
            });
          } else if (fromStatus === "in_progress" && toKind === "completed") {
            await questMutations.complete(quest.id, {});
          }
        } catch (error) {
          // Put the card back where it was: the server refused, so the
          // optimistic position is a lie.
          setQuests(before);
          throw error;
        }
        await reload();
      },
    },
    [
      alepha,
      questApi,
      kanbanApi,
      epicApi,
      queries,
      questMutations,
      toaster,
      dialog,
      tr,
      input,
    ],
  );
};
