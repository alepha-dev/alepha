import type { Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { RankService } from "alepha/api/organizations";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import type { Quest } from "../entities/quests.ts";

/**
 * The shared authorship alternative, including a no-op automation request.
 */
export class QuestEditAccess {
  protected readonly ranks = $inject(RankService);
  public async assert(
    quest: Pick<Quest, "createdBy">,
    project: Pick<Project, "organizationId">,
    user: UserAccountToken,
  ): Promise<void> {
    if (
      quest.createdBy !== user.id &&
      !(await this.ranks.can(project.organizationId!, "quest:delete", user))
    )
      throw new ForbiddenError(
        "Only the quest creator, or somebody who may delete quests here, can edit this quest",
      );
  }
}
