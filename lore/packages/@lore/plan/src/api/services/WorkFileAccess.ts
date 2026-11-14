import { FileAccessRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { FeedbackRateLimiter } from "./FeedbackRateLimiter.ts";

/**
 * Who may read Work's attachments, registered on core's `FileAccessRegistry`
 * (#E75, #Q2623): any project member may view a quest attachment, and the
 * project's triagers may read the attachments reporters send with feedback.
 */
export class WorkFileAccess {
  /**
   * Quest attachments bucket inherits the property name when no `name:` is
   * passed to `$storage(...)` — see `QuestController.attachments`.
   */
  public static readonly QUEST_ATTACHMENT_BUCKET = "attachments";

  protected readonly registry = $inject(FileAccessRegistry);
  protected readonly feedback = $repository(feedback);
  protected readonly quests = $repository(quests);

  constructor() {
    this.registry.register(
      FeedbackRateLimiter.ATTACHMENT_BUCKET,
      async (fileId) => {
        const [row] = await this.feedback.findMany(this.listing(fileId), {
          force: true,
        });
        return row
          ? { projectId: row.projectId, permission: "feedback:triage" }
          : undefined;
      },
    );
    this.registry.register(
      WorkFileAccess.QUEST_ATTACHMENT_BUCKET,
      async (fileId) => {
        const [row] = await this.quests.findMany(this.listing(fileId), {
          force: true,
        });
        return row
          ? { projectId: row.projectId, permission: "quest:read" }
          : undefined;
      },
    );
  }

  /**
   * The row that lists `fileId` in its `attachments` JSON array. A LIKE
   * against the JSON text: rows are small and the id is a UUID, so a false
   * hit would need a UUID inside another value.
   *
   * Read with `force` by both callers: a soft-deleted row still owns its
   * files, and who may read them is still its project's question.
   */
  protected listing(fileId: string) {
    return {
      where: { attachments: { like: `%"${fileId}"%` } },
      columns: ["id", "projectId"] as Array<"id" | "projectId">,
      limit: 1,
    };
  }
}
