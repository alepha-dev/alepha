import type { EpicRefResource } from "../../../../../api/schemas/epicRefResourceSchema.ts";

/**
 * Why a quest cannot be accepted, as a CODE: its epic's phase refuses it.
 *
 * ⚠️ A code and not the reason. The reason is a `tr` call over two keys with
 * the epic's number as an argument, and a pure helper cannot make a
 * localized string. `QuestView` maps the code to its key and keeps its
 * tooltip. It also gated the agent prompts until #Q4281; what a prompt is
 * offered on is its arg's accepted statuses now.
 */
export type QuestAcceptGateReason =
  | "epicDraft"
  | "epicCompleted"
  | "epicShelved";

/**
 * Whether a quest's epic is in a status that would refuse the acceptance.
 *
 * `quest_accept` is refused under a `draft` epic (it is not ready for
 * development), a `completed` one ("File this in a new epic") and a
 * `shelved` one (#E78) until it is unshelved. A `ready` epic accepts, and
 * that accept is what starts it (#Q2223).
 *
 * ⚠️ A ready epic whose predecessor is not completed also refuses, and this
 * does not see it: an epic ref carries no `dependsOn`. The server answers
 * 400 with the reason, which is the rule below applied to one more case.
 *
 * ⚠️ **When the epic list could not be read, the gate OPENS.**
 * `currentEpicsAtom` is `undefined` after a failed read (the loader's
 * deliberate `.catch`) and `[]` when the `plan.epics` option is off; either
 * way the epic resolves to `undefined` and this answers `undefined`. That is
 * what the quest page's Accept button already does, so the shared helper
 * keeps that behaviour rather than inventing a third one: the server is
 * still the authority, and it answers 400.
 *
 * A quest with no epic at all is never withheld.
 */
/**
 * The sentence each code reads as, for the one surface that prints it
 * (`QuestView`'s withheld Accept). A record, so a new code cannot ship
 * without its key.
 */
export const QUEST_ACCEPT_GATE_LABEL_KEYS: Record<
  QuestAcceptGateReason,
  | "quest.view.accept.epicDraft"
  | "quest.view.accept.epicCompleted"
  | "quest.view.accept.epicShelved"
> = {
  epicDraft: "quest.view.accept.epicDraft",
  epicCompleted: "quest.view.accept.epicCompleted",
  epicShelved: "quest.view.accept.epicShelved",
};

export const questAcceptGate = (
  quest: { epicId?: number | null },
  epics: EpicRefResource[] | undefined,
): QuestAcceptGateReason | undefined => {
  if (quest.epicId == null) return undefined;
  const epic = epics?.find((it) => it.id === quest.epicId);
  if (!epic) return undefined;
  if (epic.status === "draft") return "epicDraft";
  if (epic.status === "completed") return "epicCompleted";
  if (epic.status === "shelved") return "epicShelved";
  return undefined;
};
