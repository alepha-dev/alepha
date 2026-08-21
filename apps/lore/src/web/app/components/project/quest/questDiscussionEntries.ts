import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * One row of the Discussion: a system event or a human comment, interleaved
 * by timestamp into a single list.
 *
 * Two stacked lists read as bolted on; one feed is what makes a quest feel
 * alive. That is the whole reason this builder exists rather than the feed
 * rendering `quest.history` and `comments` side by side.
 */
export type QuestDiscussionEntry =
  | {
      kind: "event";
      /** Stable across renders — the feed keys on it. */
      key: string;
      at: string;
      by?: string;
      action: QuestEventAction;
      /** The objective's title, for `objective_completed`. */
      subject?: string;
      /** The feedback item a quest was promoted from, for `created`. */
      feedbackId?: number;
      /**
       * Markdown the event carries as its own body, rendered under the
       * header line the way a comment's body is. Only `completed` has one
       * today: the completion summary is what the person said on their way
       * out, so it belongs in the conversation rather than in a section of
       * its own further up the page.
       */
      body?: string;
      /**
       * The quest the body belongs to. Only set alongside `body`, because it
       * exists solely so the viewer can resolve `[[...]]` references against
       * the right project.
       */
      questId?: number;
      /**
       * Set when the body was amended after the event happened. The old
       * standalone section said "edited X ago"; in the feed that becomes the
       * same "edited" marker a comment carries, so one vocabulary covers
       * both kinds of written entry.
       */
      bodyEdited?: boolean;
      /**
       * Objectives closed without being done, listed on the `completed`
       * event above its summary.
       *
       * Folded onto the completion rather than rendered as their own rows.
       * Every waiver is stamped by the same person at the same instant as
       * the completion it is part of, so separate rows would repeat the
       * actor and the time and say nothing the card does not.
       */
      waivers?: Array<{ title: string; reason: string }>;
    }
  | {
      kind: "comment";
      key: string;
      at: string;
      by?: string;
      comment: QuestCommentResource;
    };

export type QuestEventAction =
  | "created"
  | "updated"
  | "assigned"
  | "unassigned"
  | "completed"
  | "objective_completed"
  | "objective_waived"
  | "reminder_sent"
  | "shelved"
  | "unshelved";

/**
 * Builds the feed from what the quest already carries.
 *
 * Nothing here is fetched: `history[]` has `by` and `at` on every entry, and
 * the two events that are NOT in it are derivable — `created` from
 * `createdAt` / `createdBy` (and `feedbackId`, which is what makes the row
 * say "from feedback #62"), `completed` from `completedAt` / `completedBy`.
 * The old timeline pushed both by hand and then hardcoded "by You" for the
 * actor of all three, which is the bug this replaces.
 *
 * Oldest first: a conversation reads downwards.
 */
export const buildQuestDiscussionEntries = (
  quest: QuestResource,
  comments: QuestCommentResource[],
): QuestDiscussionEntry[] => {
  const entries: QuestDiscussionEntry[] = [
    {
      kind: "event",
      key: "created",
      at: quest.createdAt,
      by: quest.createdBy,
      action: "created",
      feedbackId: quest.feedbackId ?? undefined,
    },
  ];

  for (const [index, event] of quest.history.entries()) {
    // `objective_waived` is kept out of the feed as a row of its own: it is
    // part of the completion, and the completion card lists every waiver
    // with its reason. The history row stays written, because it is the
    // audit record of who waived what and when.
    if (event.action === "objective_waived") {
      continue;
    }
    entries.push({
      kind: "event",
      key: `history-${index}`,
      at: event.at,
      by: event.by,
      action: event.action as QuestEventAction,
      subject:
        event.objectiveId != null
          ? quest.objectives.find((o) => o.id === event.objectiveId)?.title
          : undefined,
    });
  }

  if (quest.completedAt) {
    entries.push({
      kind: "event",
      key: "completed",
      at: quest.completedAt,
      by: quest.completedBy,
      action: "completed",
      // The completion summary rides on this event rather than standing as
      // its own section. It is dated, authored and about the quest ending,
      // which is exactly the event it now hangs under.
      body: quest.completionMessage || undefined,
      questId: quest.id,
      bodyEdited:
        !!quest.completionMessage &&
        !!quest.completionMessageUpdatedAt &&
        quest.completionMessageUpdatedAt !== quest.completedAt,
      // Read off the objectives rather than the history rows: the reason
      // lives on the objective, and this way the card cannot disagree with
      // the checklist above it.
      waivers: quest.objectives
        .filter((objective) => objective.waivedReason)
        .map((objective) => ({
          title: objective.title,
          reason: objective.waivedReason as string,
        })),
    });
  }

  for (const comment of comments) {
    entries.push({
      kind: "comment",
      key: `comment-${comment.id}`,
      at: comment.createdAt,
      by: comment.authorId ?? undefined,
      comment,
    });
  }

  return entries.sort((a, b) => a.at.localeCompare(b.at));
};
