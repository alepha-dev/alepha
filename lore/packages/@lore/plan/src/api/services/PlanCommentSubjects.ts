import { CommentService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { quests } from "../entities/quests.ts";

/**
 * Plan's subjects on core's `comments` table (#E185): what gives a quest
 * its discussion.
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

  protected readonly comments = $inject(CommentService);
  protected readonly quests = $repository(quests);

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
  }
}
