import type { EpicRefResource } from "@/api/schemas/epicRefResourceSchema.ts";

/**
 * Why a quest cannot be handed to an agent, as a CODE.
 *
 * ⚠️ A code and not the reason. The reason is a `tr` call over two keys with
 * the epic's number as an argument, and a pure helper shared by two tables
 * cannot make a localized string. `QuestView` maps the code to its key and
 * keeps its tooltip; the tables only test for `undefined`.
 */
export type QuestAgentGateReason = "epicPlanned" | "epicCompleted";

/**
 * Whether a quest's epic is in a status that would refuse the work.
 *
 * The prompt's second step is `quest_accept`, which a `planned` epic refuses
 * (it is not ready for development) and a `completed` one refuses with "File
 * this in a new epic". A `ready` epic accepts, and that accept is what starts
 * it (#Q2223). So the gate on offering the prompt is the gate on accepting
 * the quest, and this is the one place both express it.
 *
 * ⚠️ A ready epic whose predecessor is not completed also refuses, and this
 * does not see it: an epic ref carries no `dependsOn`. The server answers
 * 400 with the reason, which is the rule below applied to one more case.
 *
 * ⚠️ **When the epic list could not be read, the gate OPENS.**
 * `currentEpicsAtom` is `undefined` after a failed read (the loader's
 * deliberate `.catch`) and `[]` when the `work.epics` option is off; either
 * way the epic resolves to `undefined` and this answers `undefined`. That is
 * what the quest page's Accept button already does, so the shared helper
 * keeps that behaviour rather than inventing a third one: the server is
 * still the authority, and it answers 400.
 *
 * A quest with no epic at all is never withheld.
 */
export const questAgentGate = (
  quest: { epicId?: number | null },
  epics: EpicRefResource[] | undefined,
): QuestAgentGateReason | undefined => {
  if (quest.epicId == null) return undefined;
  const epic = epics?.find((it) => it.id === quest.epicId);
  if (!epic) return undefined;
  if (epic.status === "planned") return "epicPlanned";
  if (epic.status === "completed") return "epicCompleted";
  return undefined;
};
