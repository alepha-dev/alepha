import { z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { quests } from "../entities/quests.ts";

/**
 * What deleting an account would take of Work: the quests it authored.
 *
 * Moved out of `UserDeletionHook` when core stopped reading Work's tables
 * (#E75, #Q2623). The action keeps its name and path; the account page asks
 * it before the delete button, and the hook itself stays core.
 */
export class QuestAuthorshipController {
  protected readonly quests = $repository(quests);

  /**
   * How many quests this account authored that its deletion would take with it.
   *
   * `quests.createdBy` is `onDelete: "cascade"`, so those quests go — including
   * ones inside projects belonging to other people. The hook does not refuse on
   * them (see above), which makes stating the number before the click the only
   * thing standing between the person and a surprise. The account page reads
   * this to fill `AccountSecurityProps.deleteWarning`.
   *
   * A question, not a decision — which is why it is an action beside the hook
   * rather than part of it.
   */
  countMyAuthoredQuests = $action({
    method: "GET",
    path: "/users/me/authored-quests",
    use: [$secure()],
    description: "How many quests the caller authored",
    schema: {
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ user }) => ({
      count: await this.quests.count({ createdBy: { eq: user.id } }),
    }),
  });
}
