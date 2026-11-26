import { CommentService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";

/**
 * Plan's subjects on core's `comments` table (#E185): what gives a quest
 * its discussion and a feedback item its thread.
 *
 * `load` is the cross-project guard `CommentService.add` runs before every
 * write: the row of that project by its global id, or a 404. It is never
 * the permission check, which stays with each controller.
 */
export class PlanCommentSubjects {
  /**
   * The value of `comments.subjectType` for a quest's discussion. Its
   * `subjectId` is `quests.id`.
   */
  public static readonly QUEST = "quest";

  /**
   * The value of `comments.subjectType` for a feedback item's thread. Its
   * `subjectId` is `feedback.id`.
   */
  public static readonly FEEDBACK = "feedback";

  protected readonly comments = $inject(CommentService);
  protected readonly quests = $repository(quests);
  protected readonly feedback = $repository(feedback);

  constructor() {
    this.comments.registerSubject({
      type: PlanCommentSubjects.QUEST,
      load: async (projectId, questId) => {
        const quest = await this.quests.findOne({
          where: { id: { eq: questId }, projectId: { eq: projectId } },
        });
        if (!quest) {
          throw new NotFoundError("Quest not found");
        }
        return quest;
      },
    });
    // ⚠️ Not the membership gate: a feedback thread is open to the item's
    // reporter, who is often no member, and `FeedbackCommentController`
    // decides who reads and writes. This only says the item is this
    // project's.
    this.comments.registerSubject({
      type: PlanCommentSubjects.FEEDBACK,
      load: async (projectId, feedbackId) => {
        const item = await this.feedback.findOne({
          where: { id: { eq: feedbackId }, projectId: { eq: projectId } },
        });
        if (!item) {
          throw new NotFoundError("Feedback not found");
        }
        return item;
      },
    });
  }
}
